# epub companion — 설계 가이드

## 개요

무료 epub를 제공하는 두 사이트의 책 목록을 로컬에 인덱싱하고, 검색·필터·다운로드를 한 곳에서 처리하는 로컬 웹앱.

- **런타임**: Node.js 24 (Express 백엔드) + React 18 (Vite 프론트엔드)
- **언어**: TypeScript (전체)
- **저장소**: SQLite — `node:sqlite` 빌트인 모듈 (동기 API)
- **포트**: 3001 (단일 서버, 프로덕션 빌드 기준)
- **데이터 경로**: 사용자 설정 가능 (기본값: `./data`)

지원 소스:

| 소스              | slug 접두사          | 크롤링 단위     | 증분 방식                      |
| ----------------- | -------------------- | --------------- | ------------------------------ |
| epubbooks.com     | 없음 (예: `fiction`) | 주제(subject)   | `last_crawled_at` 24h 임계값   |
| Project Gutenberg | `g_` (예: `g_649`)   | 서가(bookshelf) | `crawl_offset` + `start_index` |

---

## 기술 스택

| 레이어        | 기술                                    |
| ------------- | --------------------------------------- |
| 백엔드        | Node.js 24, Express, TypeScript         |
| 프론트엔드    | React 18, TypeScript, Vite              |
| DB            | SQLite (`node:sqlite` 빌트인, 동기 API) |
| 전문검색      | SQLite FTS5 (`unicode61` 토크나이저)    |
| 스크래핑      | axios, cheerio                          |
| UI            | TailwindCSS                             |
| 가상 스크롤   | @tanstack/react-virtual v3              |
| 실시간 진행률 | Server-Sent Events (SSE)                |

---

## 프로젝트 구조

```text
epub-companion/
├── src/
│   ├── server/
│   │   ├── index.ts                   # Express 엔트리포인트, 미들웨어, 라우트 등록
│   │   ├── types.ts                   # 서버 공통 타입 (Book, Subject, Settings, IndexUpdateEvent 등)
│   │   ├── routes/
│   │   │   ├── books.ts               # 책 검색·조회·다운로드·삭제 API
│   │   │   ├── subjects.ts            # 주제 목록 API
│   │   │   ├── index-update.ts        # 크롤링 제어 + SSE 브로드캐스트
│   │   │   └── settings.ts            # 설정 조회·저장 API
│   │   └── services/
│   │       ├── database.ts            # SQLite 스키마 초기화·마이그레이션·쿼리 계층
│   │       ├── crawler.ts             # epubbooks.com 크롤러
│   │       ├── gutenberg-crawler.ts   # Gutenberg 크롤러 (증분, crawl_offset 기반)
│   │       └── storage.ts             # epub 파일 경로 계산·저장
│   └── client/
│       ├── main.tsx
│       ├── App.tsx                    # 소스 선택, 검색, 주제 필터, 모달 조합
│       ├── types.ts                   # 클라이언트 공통 타입
│       ├── api/
│       │   └── client.ts              # fetch 래퍼 (books, subjects, index, settings)
│       ├── hooks/
│       │   └── useBooks.ts            # 책 목록·검색·페이지네이션 상태
│       └── components/
│           ├── Header.tsx             # 소스 탭 + 검색바 + Update Index 스플릿 버튼
│           ├── SubjectFilter.tsx      # 주제 탭 필터 (가로 스크롤)
│           ├── BookGrid.tsx           # 가상 스크롤 카드 목록
│           ├── BookCard.tsx           # 커버·제목·저자·다운로드 상태 카드
│           ├── UpdateIndexModal.tsx   # SSE 기반 크롤링 진행 모달 (force 옵션 포함)
│           └── SettingsModal.tsx      # 저장 경로·커버 표시 설정 모달
├── data/
│   └── index.sqlite                   # 메타데이터 DB
├── epub-companion.bat                 # Windows 실행 스크립트
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 데이터베이스 스키마

```sql
-- 주제 / 서가 목록
CREATE TABLE subjects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT UNIQUE NOT NULL,               -- epubbooks: 'fiction', Gutenberg: 'g_649'
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  book_count      INTEGER DEFAULT 0,
  last_crawled_at TEXT,                               -- ISO8601; NULL = 미완료(진행 중 포함)
  source          TEXT NOT NULL DEFAULT 'epubbooks',  -- 'epubbooks' | 'gutenberg'
  crawl_offset    INTEGER NOT NULL DEFAULT 0          -- Gutenberg 증분용: 처리된 항목 수
);

-- epub 책 목록
CREATE TABLE books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id       TEXT UNIQUE NOT NULL,       -- epubbooks: 숫자 문자열, Gutenberg: 숫자 문자열
  source        TEXT NOT NULL DEFAULT 'epubbooks',
  title         TEXT NOT NULL,
  author        TEXT NOT NULL,
  subject_slug  TEXT NOT NULL,              -- 최초 인덱싱된 주제 (표시용 primary subject)
  cover_url     TEXT,
  book_url      TEXT NOT NULL,
  download_url  TEXT,
  description   TEXT,
  local_path    TEXT,                       -- NULL = 미다운로드
  downloaded_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 책 ↔ 주제 다대다 관계
-- 한 책이 여러 서가에 등록된 경우 모든 관계를 저장
CREATE TABLE book_subjects (
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, subject_id)
);
CREATE INDEX idx_book_subjects_subject ON book_subjects(subject_id);

-- FTS5 전문검색 (title, author, description)
-- INSERT/UPDATE/DELETE 트리거로 books 테이블과 자동 동기화
CREATE VIRTUAL TABLE books_fts USING fts5(
  title, author, description,
  tokenize='unicode61'
);

-- 애플리케이션 설정 (key-value)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- data_path        : epub 저장 루트 경로
  -- last_full_update : 마지막 갱신 완료 시각 (ISO8601)
  -- hide_cover       : 'true' | 'false'
);
```

### 마이그레이션 전략

`initDatabase()` 호출 시 `PRAGMA table_info`로 컬럼 존재 여부를 확인하고 필요한 `ALTER TABLE`을 실행합니다. `book_subjects` 테이블 신설 시 기존 `books.subject_slug` 데이터를 자동으로 마이그레이션합니다.

---

## API 엔드포인트

### Books

| 메서드 | 경로                      | 설명                                                        |
| ------ | ------------------------- | ----------------------------------------------------------- |
| GET    | `/api/books`              | 검색·조회 (`?q=&subject=&source=&downloaded=&page=&limit=`) |
| GET    | `/api/books/stats`        | 전체·다운로드 수 집계 (`?source=`)                          |
| GET    | `/api/books/:id`          | 책 상세 조회                                                |
| POST   | `/api/books/:id/download` | epub 다운로드 후 로컬 저장                                  |
| DELETE | `/api/books/:id/download` | 로컬 파일 삭제 및 DB 참조 초기화                            |

### Subjects

| 메서드 | 경로            | 설명                   |
| ------ | --------------- | ---------------------- |
| GET    | `/api/subjects` | 주제 목록 (`?source=`) |

### Index Update

| 메서드 | 경로                | 설명                                     |
| ------ | ------------------- | ---------------------------------------- |
| POST   | `/api/index/update` | 크롤링 시작 (`?source=&force=&subject=`) |
| GET    | `/api/index/status` | 크롤링 진행 상태 SSE 스트림              |
| GET    | `/api/index/active` | 크롤링 실행 중 여부 확인                 |

### Settings

| 메서드 | 경로            | 설명                                  |
| ------ | --------------- | ------------------------------------- |
| GET    | `/api/settings` | 설정 조회                             |
| PUT    | `/api/settings` | 설정 저장 (`data_path`, `hide_cover`) |

---

## 크롤링 전략

### epubbooks 크롤러 (`crawler.ts`)

```text
POST /api/index/update?source=epubbooks
  │
  ├── 1. epubbooks.com/subjects 파싱 → subjects upsert
  │
  ├── 2. last_crawled_at 기준 필터링 (24h 이내 크롤된 주제 스킵)
  │       subject 파라미터가 있으면 해당 주제만 처리
  │
  ├── 3. 동시 3개 주제 병렬 크롤
  │       각 주제 페이지 순차 로딩 (페이지네이션, DELAY_MS=700ms)
  │       hasNextPage = HTML 페이지네이션 요소 존재 여부
  │
  ├── 4. getExistingBookIds(slug) 로 이미 이 주제에 연결된 book_id 조회
  │       신규 book_id만 upsertBook → book_subjects 관계 추가
  │
  └── 5. 주제 완료 시 last_crawled_at 갱신
```

### Gutenberg 크롤러 (`gutenberg-crawler.ts`)

```text
POST /api/index/update?source=gutenberg
  │
  ├── 1. gutenberg.org/ebooks/categories 파싱 → subjects upsert (slug=g_{id})
  │
  ├── 2. 처리 대상 선정
  │       force=true : 모든 서가 offset 초기화 후 전체 재수집
  │       force=false: last_crawled_at=NULL(미완료) 또는 7일 이상 경과한 서가만
  │       subject 파라미터가 있으면 해당 서가만 처리
  │
  ├── 3. 서가별 순차 크롤 (DELAY_MS=600ms)
  │       start_index = crawl_offset + 1 (1-based)
  │       rawCount = 페이지의 li.booklink 수 (파싱 성공 여부 무관)
  │       offset += rawCount (파싱 실패 항목도 건너뛰어야 하므로)
  │
  ├── 4. upsertBook() 호출 (항상)
  │       isNew=true  → totalAdded++ (신규 책)
  │       isNew=false → totalSkipped++ (이미 다른 서가로 인덱싱됨)
  │       두 경우 모두 book_subjects 관계 추가 (INSERT OR IGNORE)
  │
  ├── 5. rawCount=0 이면 서가 끝 → last_crawled_at 갱신, 다음 서가로
  │
  └── 6. totalAdded >= BATCH_LIMIT(1000) 이면 batch_limit 이벤트 후 중단
```

### SSE 이벤트 타입

```text
{ type: 'crawling' }                                     # 이미 크롤링 진행 중
{ type: 'start',      totalSubjects: 25 }
{ type: 'subject',    name: 'Fiction', done: 1, total: 25 }
{ type: 'book',       title: '...', new: true }
{ type: 'complete',   added: 42,   skipped: 1203 }
{ type: 'batch_limit',added: 1000, skipped: 203, hasMore: true }
{ type: 'error',      message: '...' }
```

---

## 다운로드 흐름

### epubbooks.com (3단계)

```text
1. GET {book_url}
   → Set-Cookie 수집 (jar)
   → data-dlid 추출 (다운로드 식별자)
   → X-CSRF-Token 추출

2. POST /downloads  { id: dlid }  (Cookie + CSRF 헤더 포함)
   → Set-Cookie 추가 수집
   → 시한부 토큰 id 획득

3. GET /downloads/{token_id}/file  (jar 포함)
   → Content-Type 확인 (text/html 이면 에러)
   → ArrayBuffer 수신 → Buffer 변환
```

### Project Gutenberg (직접 GET)

```text
GET https://www.gutenberg.org/ebooks/{book_id}.epub.images
  → Content-Type 확인 (text/html 이면 에러)
  → ArrayBuffer 수신 → Buffer 변환
```

---

## 파일 저장 규칙

저장 경로: `<data_path>/<author>/<title>.epub`

```typescript
function sanitize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')    // 발음기호 제거
    .replace(/[^a-z0-9]+/g, '_')        // 영문소문자·숫자 외 → _
    .replace(/^_+|_+$/g, '')            // 앞뒤 _ 제거
    .slice(0, 64)
}
```

동일 경로 충돌 시 `_2`, `_3` suffix 추가.

---

## UI 구성

```text
┌─────────────────────────────────────────────────────────────────────┐
│  [epubbooks | Gutenberg]  [🔍 Search…  /]  [Update Index|▼] [⚙]    │
│  [All] [Fiction] [History] [Science] [Mystery] ···  (가로스크롤)    │
│  1,438 books  •  12 downloaded                                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐         │
│  │[cover] │  │[cover] │  │[cover]✓│  │[cover] │  │[cover] │         │
│  │ Title  │  │ Title  │  │ Title  │  │ Title  │  │ Title  │         │
│  │ Author │  │ Author │  │ Author │  │ Author │  │ Author │         │
│  │[Down↓] │  │[Down↓] │  │✓ Saved │  │[Down↓] │  │[Down↓] │         │
│  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

### Update Index 스플릿 버튼

- **왼쪽** `Update Index` 클릭 → 일반 크롤링 시작
- **오른쪽** `▼` 클릭 → 팝오버에 `Force Update Index` 표시
  - Force 선택 시 crawl_offset 초기화 후 처음부터 재수집

### 주제 선택 + Update Index

주제를 선택한 상태에서 Update Index를 누르면 해당 주제만 크롤링합니다.
Gutenberg의 경우 Force와 조합하면 특정 서가의 누락된 book_subjects 관계를 보완할 수 있습니다.

### Settings 모달

- **Data path**: epub 저장 루트 디렉토리 (자유 지정)
- **Hide book cover images**: 커버 이미지 숨김 토글 — 가상 스크롤 높이 자동 조정

---

## 검색 구현

```text
q 파라미터 존재 시  → FTS5 MATCH 쿼리 (PREFIX 검색, 마지막 단어에 * 붙임)
                     결과 정렬: rank (FTS5 relevance)
q 파라미터 없을 시  → 일반 SELECT
                     결과 정렬: first_seen_at DESC

subject 필터 → book_subjects JOIN으로 다대다 지원
source  필터 → books.source = ?
downloaded  → local_path IS NOT NULL / IS NULL
```

FTS 쿼리 빌드 예시: `"mark twain"` → `mark twain*`

---

## 설계 결정 사항

### `node:sqlite` 동기 API 선택

Node.js 24 빌트인 `DatabaseSync`를 사용합니다. 외부 의존성 없이 동기 코드로 DB 접근이 가능하여 비동기 래퍼 없이도 단순한 코드를 유지합니다.

### 단일 서버 포트

프로덕션 빌드에서는 Express가 Vite 빌드 결과물을 정적 파일로 서빙합니다. 포트 3001 하나만 사용하므로 CORS 설정이 불필요합니다.

### 다대다 book_subjects 테이블

Gutenberg 책은 여러 서가에 중복 등록됩니다. `books.subject_slug`는 최초 인덱싱 서가를 기록하고(표시용), `book_subjects`는 책이 속하는 모든 서가 관계를 저장합니다. `searchBooks`의 subject 필터는 `book_subjects` JOIN을 사용합니다.

### Gutenberg 증분 크롤링

서가 페이지는 `start_index` 파라미터(1-based)로 페이지를 이동합니다. `crawl_offset`은 이미 처리한 항목 수를 저장하므로 `start_index = crawl_offset + 1`로 이어서 시작합니다. `offset` 증가에는 파싱 성공 여부와 무관한 `rawCount`(실제 `li.booklink` 수)를 사용합니다.

### BATCH_LIMIT

한 번 실행 시 신규 책 1,000건을 초과하면 `batch_limit` 이벤트를 emit하고 중단합니다. 다음 실행 시 `crawl_offset`이 보존되어 있어 이어서 수집합니다.

### 파일 저장을 서버에서 수행

epubbooks.com은 브라우저에서 직접 접근이 불가능한(CORS, 세션 쿠키) 다운로드 절차를 갖습니다. 다운로드 전 흐름(쿠키 취득 → 토큰 발급)을 모두 서버에서 처리하여 클라이언트를 단순하게 유지합니다.
