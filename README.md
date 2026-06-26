# epubbooks companion

[epubbooks.com](https://www.epubbooks.com/)의 미흡한 기능을 보완하는 로컬 웹앱.

epubbooks.com은 무료 epub를 제공하지만 다운로드 이력을 기억하지 않습니다. epubbooks companion은 이를 보완합니다.

## 주요 기능

- **인덱스 수집**: epubbooks.com의 전체 epub 목록을 로컬 SQLite DB에 저장
- **증분 업데이트**: 이미 수집한 주제는 스킵하고 신규 항목만 추가
- **빠른 검색**: SQLite FTS5 전문검색으로 제목·저자·설명 검색
- **주제 필터**: Fiction, History, Science 등 카테고리별 필터링
- **다운로드 상태 표시**: 이미 받은 책과 안 받은 책을 한눈에 구분
- **원클릭 다운로드**: 클릭 한 번으로 `data/<author>/<title>.epub`에 저장
- **설정 가능한 저장 경로**: epub를 저장할 디렉토리를 자유롭게 지정

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

## 사용 방법

1. **첫 실행 시**: 우상단 ⚙ Settings에서 epub 저장 경로를 지정합니다.
2. **Update Index**: 버튼을 클릭하면 epubbooks.com에서 전체 epub 목록을 수집합니다. 진행 상황이 실시간으로 표시됩니다.
3. **검색**: 검색창에 제목이나 저자명을 입력하면 즉시 결과가 업데이트됩니다.
4. **필터**: 상단 주제 탭으로 카테고리를 좁힐 수 있습니다.
5. **다운로드**: 카드의 Download 버튼을 클릭하면 서버가 epub를 받아 로컬에 저장합니다.

## 파일 저장 규칙

저장 경로: `<data_path>/<author>/<title>.epub`

파일명은 모든 OS에서 호환되도록 영문 소문자, 숫자, 언더바만 사용합니다.

```text
data/
  mark_twain/
    the_adventures_of_tom_sawyer.epub
    adventures_of_huckleberry_finn.epub
  jane_austen/
    pride_and_prejudice.epub
```

## 프로젝트 구조

```text
epubbooks-companion/
├── src/
│   ├── server/          # Express 백엔드
│   │   ├── routes/      # API 엔드포인트
│   │   └── services/    # 크롤러, DB, 파일 관리
│   └── client/          # React 프론트엔드
│       ├── components/
│       └── hooks/
├── data/
│   └── index.sqlite     # epub 메타데이터 DB
└── DEVPLAN.md           # 개발 계획
```
