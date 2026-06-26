# epubbooks companion — 개발 계획

## 개요

epubbooks.com의 미흡한 기능(다운로드 이력 추적, 검색)을 보완하는 로컬 웹앱.

- **런타임**: Node.js(Express) 백엔드 + React(Vite) 프론트엔드
- **언어**: TypeScript (전체)
- **저장소**: SQLite (`data/index.sqlite`)
- **데이터 경로**: 사용자 설정 가능 (기본값: `./data`)

---

## 기술 스택

| 레이어        | 기술                         |
| ------------- | ---------------------------- |
| 백엔드        | Node.js, Express, TypeScript |
| 프론트엔드    | React 18, TypeScript, Vite   |
| DB            | SQLite (node:sqlite 빌트인)  |
| 스크래핑      | axios, cheerio               |
| UI            | TailwindCSS                  |
| 가상 스크롤   | @tanstack/react-virtual      |
| 실시간 진행률 | Server-Sent Events (SSE)     |

---

## 프로젝트 구조

```text
epubbooks-companion/
├── package.json                  # 루트 (워크스페이스 or 단일)
├── tsconfig.json                 # 서버 TS 설정
├── tsconfig.client.json          # 클라이언트 TS 설정
├── vite.config.ts                # Vite 설정 (client)
├── DEVPLAN.md
│
├── src/
│   ├── server/
│   │   ├── index.ts              # Express 엔트리포인트
│   │   ├── routes/
│   │   │   ├── books.ts          # 검색/조회 API
│   │   │   ├── download.ts       # epub 다운로드 API
│   │   │   ├── index-update.ts   # 크롤링/인덱스 갱신 API
│   │   │   ├── subjects.ts       # 주제 목록 API
│   │   │   └── settings.ts       # 설정 API
│   │   ├── services/
│   │   │   ├── crawler.ts        # epubbooks.com 스크래퍼
│   │   │   ├── database.ts       # SQLite 접근 계층
│   │   │   └── storage.ts        # 파일시스템 관리
│   │   └── types.ts
│   │
│   └── client/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   └── client.ts         # fetch 래퍼
│       ├── components/
│       │   ├── Header.tsx        # 검색바 + 버튼 영역
│       │   ├── BookGrid.tsx      # 가상 스크롤 목록
│       │   ├── BookCard.tsx      # 개별 책 카드
│       │   ├── SubjectFilter.tsx # 주제 필터
│       │   ├── UpdateIndexModal.tsx  # 크롤링 진행 모달
│       │   └── SettingsModal.tsx # 경로 설정 모달
│       ├── hooks/
│       │   ├── useBooks.ts       # 책 목록/검색 상태
│       │   └── useSSE.ts         # SSE 연결 훅
│       └── types.ts
│
└── data/                         # 기본 데이터 디렉토리
    └── index.sqlite
```

---

## 데이터베이스 스키마

```sql
-- 주제 목록
CREATE TABLE subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,   -- URL slug (e.g., "fiction")
  name        TEXT NOT NULL,          -- 표시명 (e.g., "Fiction")
  url         TEXT NOT NULL,
  book_count  INTEGER DEFAULT 0,
  last_crawled_at TEXT               -- ISO8601, NULL=미크롤
);

-- epub 책 목록
CREATE TABLE books (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      TEXT UNIQUE NOT NULL,  -- epubbooks.com 고유 ID
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  subject_slug TEXT NOT NULL,
  cover_url    TEXT,
  book_url     TEXT NOT NULL,         -- 상세 페이지 URL
  download_url TEXT,                  -- 직접 다운로드 URL
  description  TEXT,
  local_path   TEXT,                  -- 다운로드 시 저장 경로 (NULL=미다운로드)
  downloaded_at TEXT,                 -- 다운로드 시각
  first_seen_at TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- FTS5 전문검색 인덱스
CREATE VIRTUAL TABLE books_fts USING fts5(
  title, author, description,
  content='books',
  content_rowid='id'
);

-- 애플리케이션 설정
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- data_path: epub 저장 루트 경로
  -- last_full_update: 마지막 전체 갱신 시각
);
```

---

## API 엔드포인트

| 메서드 | 경로                      | 설명                                                |
| ------ | ------------------------- | --------------------------------------------------- |
| GET    | `/api/books`              | 검색/조회 (`?q=&subject=&downloaded=&page=&limit=`) |
| GET    | `/api/books/:id`          | 책 상세                                             |
| POST   | `/api/books/:id/download` | epub 다운로드 시작                                  |
| GET    | `/api/subjects`           | 주제 목록                                           |
| POST   | `/api/index/update`       | 인덱스 갱신 시작                                    |
| GET    | `/api/index/status`       | 갱신 진행 상태 (SSE)                                |
| GET    | `/api/settings`           | 설정 조회                                           |
| PUT    | `/api/settings`           | 설정 저장                                           |

---

## 크롤링 전략 (증분 업데이트)

### 흐름

```text
POST /api/index/update
  │
  ├── 1. epubbooks.com/subjects 페이지 파싱 → 주제 목록 추출
  │
  ├── 2. 각 주제별 병렬 처리 (동시 3개 제한)
  │       ├── last_crawled_at < 임계값(기본 24h) → 크롤 수행
  │       └── 최근 크롤된 주제 → 스킵
  │
  ├── 3. 각 주제 페이지에서 책 목록 파싱
  │       ├── 기존 book_id와 비교
  │       └── 신규 book_id만 상세 정보 수집 (증분)
  │
  ├── 4. DB upsert (신규 추가 / 기존 유지)
  │
  └── 5. FTS5 인덱스 갱신
```

### SSE 진행 이벤트

```text
data: {"type":"start","totalSubjects":25}
data: {"type":"subject","name":"Fiction","done":1,"total":25}
data: {"type":"book","title":"...","new":true}
data: {"type":"complete","added":42,"skipped":1203}
data: {"type":"error","message":"..."}
```

---

## 파일 저장 규칙

```typescript
function sanitize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // 발음기호 제거
    .replace(/[^a-z0-9]+/g, '_')       // 영문소문자·숫자 외 → _
    .replace(/^_+|_+$/g, '')           // 앞뒤 _ 제거
    .slice(0, 64);                     // 경로 길이 제한
}

// 저장 경로: <data_path>/<author>/<title>.epub
// 예: data/mark_twain/the_adventures_of_tom_sawyer.epub
```

중복 파일명 발생 시 `_2`, `_3` suffix 추가.

---

## UI 구성

```text
┌─────────────────────────────────────────────────────────────┐
│  epubbooks companion          [Update Index]  [⚙ Settings]  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🔍 Search books...                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│  [All] [Fiction] [History] [Science] [Mystery] ...          │
│  1,245 books  •  38 downloaded                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ [cover]  │  │ [cover]  │  │ [cover]✓ │  │ [cover]  │     │
│  │ Title    │  │ Title    │  │ Title    │  │ Title    │     │
│  │ Author   │  │ Author   │  │ Author   │  │ Author   │     │
│  │ Fiction  │  │ History  │  │ Science  │  │ Mystery  │     │
│  │[Download]│  │[Download]│  │[Saved ✓] │  │[Download]│     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

- **다운로드됨**: 초록 배지 + "Saved ✓" 버튼 (비활성)
- **미다운로드**: "Download" 버튼 (클릭 → 즉시 다운로드)
- **다운로드 중**: 진행 스피너

---

## 구현 단계

### Phase 1. 프로젝트 초기화

- [ ] `package.json` 작성 (의존성 정의)
- [ ] TypeScript, ESLint, Prettier 설정
- [ ] Vite 클라이언트 빌드 설정
- [ ] Express 서버 기본 구조

### Phase 2. 데이터베이스 계층

- [ ] `database.ts` — SQLite 초기화, 스키마 마이그레이션
- [ ] `storage.ts` — 데이터 경로 설정 관리, 파일 저장 로직
- [ ] 설정 API (`/api/settings`)

### Phase 3. 크롤러

- [ ] `crawler.ts` — epubbooks.com/subjects HTML 파싱
- [ ] 주제 목록 수집 로직
- [ ] 각 주제별 책 목록 수집 로직 (증분)
- [ ] 인덱스 갱신 API + SSE 진행 이벤트

### Phase 4. 책 API

- [ ] 검색 API (FTS5 활용, 필터 지원)
- [ ] 다운로드 API (서버에서 epub 수신 후 로컬 저장)
- [ ] 주제 목록 API

### Phase 5. React 프론트엔드

- [ ] Vite + React + TailwindCSS 초기 설정
- [ ] `Header` — 검색바, Update Index 버튼, Settings 버튼
- [ ] `SubjectFilter` — 주제 탭 필터
- [ ] `BookGrid` — 가상 스크롤 카드 목록
- [ ] `BookCard` — 커버, 제목, 저자, 다운로드 상태
- [ ] `UpdateIndexModal` — SSE 기반 실시간 진행 표시
- [ ] `SettingsModal` — 데이터 경로 설정

### Phase 6. 통합 및 완성

- [ ] 프론트/백엔드 연동 테스트
- [ ] 빠른 검색 응답 검증 (목표: 100ms 이내)
- [ ] 윈도우 경로 처리 검증 (`path.join` 일관 사용)
- [ ] `npm start` 하나로 서버+클라이언트 동시 실행

---

## 개발 환경 실행

```bash
npm install
npm run dev        # 서버(3001) + Vite 개발서버(5173) 동시 실행
npm run build      # 프로덕션 빌드
npm start          # 빌드된 앱 실행 (포트 3001)
```

---

## 고려사항

- **CORS**: epubbooks.com 직접 브라우저 접근 불가 → 모든 스크래핑·다운로드는 서버에서 수행
- **Rate limiting**: 크롤링 시 요청 간격 500ms 이상 유지 (서버 부하 방지)
- **경로 처리**: `path.join()` 사용 일관화 → Windows/macOS/Linux 호환
- **FTS5**: SQLite의 내장 전문검색 → 외부 검색엔진 불필요
- **파일 충돌**: 동일 author/title 중복 저장 방지 로직 포함
- **에러 처리**: 크롤링 중 개별 주제 실패 시 나머지 계속 진행
