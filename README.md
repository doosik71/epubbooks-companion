# epub companion

무료 epub를 제공하는 두 사이트의 책 목록을 로컬 SQLite DB에 인덱싱하고, 검색·필터·다운로드를 한 곳에서 처리하는 로컬 웹앱.

지원 소스:

- **epubbooks.com** — 저작권 소멸 epub 아카이브
- **Project Gutenberg** — 세계 최대 규모의 무료 전자책 라이브러리

## 주요 기능

- **소스 전환**: 상단 탭으로 epubbooks / Gutenberg 소스를 전환
- **인덱스 수집**: 선택한 소스의 epub 목록을 로컬 SQLite DB에 저장
- **증분 업데이트**: Gutenberg는 서가(bookshelf)별 진행 위치를 기억하여 이어서 수집, epubbooks는 24시간 이내에 크롤링한 주제 스킵
- **배치 제한**: 한 번 실행 시 최대 1,000건 추가 후 자동 중단 (이어서 실행 가능)
- **Force re-crawl**: Update Index 버튼 옆 ▼를 눌러 오프셋을 초기화하고 처음부터 재수집
- **다대다 주제 관계**: 여러 서가에 걸쳐 있는 책이 각 주제 필터에서 모두 노출됨
- **빠른 검색**: SQLite FTS5 전문검색으로 제목·저자·설명 검색
- **주제 필터**: 카테고리 탭으로 주제별 필터링 (가로 스크롤 지원)
- **특정 주제만 업데이트**: 주제를 선택한 상태에서 Update Index를 누르면 해당 주제만 크롤링
- **원클릭 다운로드**: 카드의 Download 버튼으로 epub를 `<data_path>/<source>/<title>_by_<author>.epub`에 저장
- **다운로드 이력**: 이미 받은 책과 안 받은 책을 카드 색상으로 구분, Delete로 삭제 가능
- **커버 이미지 숨기기**: Settings에서 커버 이미지를 숨겨 목록 밀도를 높일 수 있음
- **설정 가능한 저장 경로**: epub를 저장할 디렉토리를 자유롭게 지정

## 기술 스택

| 레이어        | 기술                            |
| ------------- | ------------------------------- |
| 백엔드        | Node.js 24, Express, TypeScript |
| 프론트엔드    | React 18, TypeScript, Vite      |
| DB            | SQLite (`node:sqlite` 빌트인)   |
| 스크래핑      | axios, cheerio                  |
| UI            | TailwindCSS                     |
| 가상 스크롤   | @tanstack/react-virtual         |
| 실시간 진행률 | Server-Sent Events (SSE)        |

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (서버 + 클라이언트 동시)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드된 앱 실행
npm start
```

브라우저에서 `http://localhost:3001` 접속.

### Windows 배치 파일로 실행

```bat
epub-companion.bat
```

`dist/`가 없으면 자동으로 빌드한 뒤 서버를 시작하고 브라우저를 오픈합니다.
소스 수정 후에는 `npm run build`를 직접 실행하거나 `dist/` 폴더를 삭제하면 다음 배치 실행 시 재빌드됩니다.

## 사용 방법

1. **소스 선택**: 상단 탭에서 `epubbooks` 또는 `Gutenberg`를 선택합니다.
2. **첫 실행 시**: ⚙ Settings에서 epub 저장 경로를 지정합니다.
3. **Update Index**: 버튼을 클릭하면 선택된 소스의 epub 목록을 수집합니다. 진행 상황이 실시간으로 표시됩니다.
   - 특정 주제를 선택한 상태에서 누르면 해당 주제만 크롤링합니다.
   - ▼ 버튼 → **Force Update Index**를 선택하면 진행 오프셋을 초기화하고 처음부터 재수집합니다.
4. **검색**: 검색창에 제목이나 저자명을 입력하면 즉시 결과가 업데이트됩니다. (`/` 단축키로 포커스)
5. **필터**: 상단 주제 탭으로 카테고리를 좁힐 수 있습니다.
6. **다운로드**: 카드의 Download 버튼을 클릭하면 서버가 epub를 받아 로컬에 저장합니다.

## 다운로드 방식

| 소스      | 방식                                                              |
| --------- | ----------------------------------------------------------------- |
| epubbooks | 세션 쿠키 취득 → 다운로드 ID 조회 → 토큰 발급 → epub 수신 (4단계) |
| Gutenberg | `https://www.gutenberg.org/ebooks/<id>.epub.images` 직접 GET      |

## 파일 저장 규칙

저장 경로: `<data_path>/<source>/<title>_by_<author>.epub`

파일명은 모든 OS에서 호환되도록 영문 소문자, 숫자, 언더바만 사용합니다.

```text
data/
  epubbooks/
    the_adventures_of_tom_sawyer_by_mark_twain.epub
    pride_and_prejudice_by_jane_austen.epub
  gutenberg/
    adventures_of_huckleberry_finn_by_mark_twain.epub
```

## data 폴더 백업 / 이동

다운로드한 epub 파일(`data/`)을 다른 폴더(예: 외장 드라이브, NAS 마운트 경로)로 복사하는 명령 예시입니다.

### Windows — robocopy

```bat
robocopy data D:\backup\epubs /E /XC /XN /XO
```

| 옵션  | 설명                                       |
| ----- | ------------------------------------------ |
| `/E`  | 하위 폴더 포함 전체 복사                   |
| `/XC` | 변경된 파일(크기·타임스탬프 불일치) 건너뜀 |
| `/XN` | 원본이 대상보다 새로운 파일 건너뜀         |
| `/XO` | 원본이 대상보다 오래된 파일 건너뜀         |

`/XC /XN /XO` 세 옵션을 함께 쓰면 **대상 폴더에 이미 파일이 존재하는 경우 모두 건너뜁니다.** 원본에만 있는 신규 파일만 복사됩니다.

진행 상황을 로그로 남기려면 `/LOG:copy.log`를 추가하세요.

```bat
robocopy data F:\epub-companion /E /XN /XO
```

### Linux / macOS — rsync

```bash
rsync -av --ignore-existing data/ /mnt/backup/epubs/
```

| 옵션                | 설명                                           |
| ------------------- | ---------------------------------------------- |
| `-a`                | 아카이브 모드 (하위 폴더·권한·타임스탬프 보존) |
| `-v`                | 복사 중인 파일명 출력                          |
| `--ignore-existing` | 대상에 이미 존재하는 파일 건너뜀               |

진행률을 보려면 `--progress`를 추가하세요.

```bash
rsync -av --progress --ignore-existing data/ /mnt/backup/epubs/
```

> **참고**: `data/` 뒤의 슬래시(`/`)는 폴더 내용을 복사한다는 의미입니다. 슬래시 없이 `data`로 쓰면 `epubs/data/` 형태로 한 단계 더 들어가게 됩니다.

## 프로젝트 구조

```text
epub-companion/
├── src/
│   ├── server/
│   │   ├── routes/          # API 엔드포인트 (books, subjects, settings, index-update)
│   │   └── services/
│   │       ├── database.ts        # SQLite 스키마, 쿼리, FTS5
│   │       ├── crawler.ts         # epubbooks 크롤러
│   │       └── gutenberg-crawler.ts  # Gutenberg 크롤러 (증분)
│   └── client/
│       ├── components/      # Header, BookGrid, BookCard, SubjectFilter, 모달
│       ├── hooks/           # useBooks (페이지네이션, 검색)
│       ├── api/             # fetch 래퍼
│       └── types.ts
├── data/
│   └── index.sqlite         # epub 메타데이터 + book_subjects 관계 테이블
└── epub-companion.bat       # Windows 실행 스크립트
```

## DB 스키마 개요

```sql
books          -- epub 메타데이터 (book_id UNIQUE)
subjects       -- 주제/서가 목록 (crawl_offset으로 증분 위치 기억)
book_subjects  -- books ↔ subjects 다대다 관계 테이블
books_fts      -- FTS5 가상 테이블 (title, author, description)
settings       -- data_path, last_full_update, hide_cover
```
