import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'
import type { Book, Subject, Settings, BooksQuery, Source } from '../types'

const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'index.sqlite')

let _db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.')
  return _db
}

// Escape special FTS5 characters and build a prefix-search query
function buildFts5Query(q: string): string {
  const terms = q
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return ''
  const last = terms.pop()! + '*'
  return [...terms, last].join(' ')
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initDatabase(): void {
  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new DatabaseSync(DB_PATH)
  const db = _db

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT UNIQUE NOT NULL,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      book_count      INTEGER DEFAULT 0,
      last_crawled_at TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL DEFAULT 'epubbooks',
      book_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      author        TEXT NOT NULL,
      subject_slug  TEXT NOT NULL,
      cover_url     TEXT,
      book_url      TEXT NOT NULL,
      download_url  TEXT,
      description   TEXT,
      local_path    TEXT,
      downloaded_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, book_id)
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
      title, author, description,
      tokenize='unicode61'
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // FTS5 sync triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
      INSERT INTO books_fts(rowid, title, author, description)
      VALUES (new.id, new.title, new.author, COALESCE(new.description, ''));
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
      DELETE FROM books_fts WHERE rowid = old.id;
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
      DELETE FROM books_fts WHERE rowid = old.id;
      INSERT INTO books_fts(rowid, title, author, description)
      VALUES (new.id, new.title, new.author, COALESCE(new.description, ''));
    END
  `)

  // Default settings
  ;(db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)') as never as { run: (...a: unknown[]) => void }).run(
    'data_path',
    path.join(process.cwd(), 'data')
  )
  ;(db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)') as never as { run: (...a: unknown[]) => void }).run(
    'last_full_update',
    ''
  )
  ;(db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)') as never as { run: (...a: unknown[]) => void }).run(
    'hide_cover',
    'false'
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS book_subjects (
      book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      PRIMARY KEY (book_id, subject_id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_book_subjects_subject ON book_subjects(subject_id)`)

  // ── Migrations ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booksInfo = (db.prepare('PRAGMA table_info(books)') as any).all() as Array<{ name: string }>
  if (!booksInfo.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'epubbooks'`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subjectsInfo = (db.prepare('PRAGMA table_info(subjects)') as any).all() as Array<{ name: string }>
  if (!subjectsInfo.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE subjects ADD COLUMN source TEXT NOT NULL DEFAULT 'epubbooks'`)
  }
  if (!subjectsInfo.some((c) => c.name === 'crawl_offset')) {
    db.exec(`ALTER TABLE subjects ADD COLUMN crawl_offset INTEGER NOT NULL DEFAULT 0`)
  }
  // Populate book_subjects from existing subject_slug (idempotent)
  db.exec(`
    INSERT OR IGNORE INTO book_subjects (book_id, subject_id)
    SELECT b.id, s.id FROM books b JOIN subjects s ON s.slug = b.subject_slug
  `)

  // Migrate books table: replace UNIQUE(book_id) with UNIQUE(source, book_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booksSql = ((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='books'`) as any).get() as { sql: string } | undefined)?.sql ?? ''
  if (!booksSql.includes('UNIQUE(source, book_id)')) {
    console.log('[db] Migrating books table to composite unique key (source, book_id)...')
    // Fix corrupt records: source='epubbooks' but URL points to Gutenberg
    run(`UPDATE books SET source = 'gutenberg' WHERE source = 'epubbooks' AND book_url LIKE 'https://www.gutenberg.org%'`)
    // Drop FTS triggers (they'll be recreated below)
    db.exec(`DROP TRIGGER IF EXISTS books_ai; DROP TRIGGER IF EXISTS books_ad; DROP TRIGGER IF EXISTS books_au`)
    // Create replacement table with correct unique constraint
    db.exec(`
      CREATE TABLE books_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        source        TEXT NOT NULL DEFAULT 'epubbooks',
        book_id       TEXT NOT NULL,
        title         TEXT NOT NULL,
        author        TEXT NOT NULL,
        subject_slug  TEXT NOT NULL,
        cover_url     TEXT,
        book_url      TEXT NOT NULL,
        download_url  TEXT,
        description   TEXT,
        local_path    TEXT,
        downloaded_at TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source, book_id)
      )
    `)
    db.exec(`
      INSERT OR IGNORE INTO books_new
        (id, source, book_id, title, author, subject_slug, cover_url, book_url, download_url, description, local_path, downloaded_at, first_seen_at, updated_at)
      SELECT id, source, book_id, title, author, subject_slug, cover_url, book_url, download_url, description, local_path, downloaded_at, first_seen_at, updated_at
      FROM books
    `)
    db.exec(`DELETE FROM books_fts`)
    db.exec(`DROP TABLE books`)
    db.exec(`ALTER TABLE books_new RENAME TO books`)
    // Recreate FTS triggers for new table
    db.exec(`
      CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN
        INSERT INTO books_fts(rowid, title, author, description)
        VALUES (new.id, new.title, new.author, COALESCE(new.description, ''));
      END
    `)
    db.exec(`
      CREATE TRIGGER books_ad AFTER DELETE ON books BEGIN
        DELETE FROM books_fts WHERE rowid = old.id;
      END
    `)
    db.exec(`
      CREATE TRIGGER books_au AFTER UPDATE ON books BEGIN
        DELETE FROM books_fts WHERE rowid = old.id;
        INSERT INTO books_fts(rowid, title, author, description)
        VALUES (new.id, new.title, new.author, COALESCE(new.description, ''));
      END
    `)
    // Repopulate FTS
    db.exec(`
      INSERT INTO books_fts(rowid, title, author, description)
      SELECT id, title, author, COALESCE(description, '') FROM books
    `)
    // Remove stale book_subjects where book.source differs from subject.source
    db.exec(`
      DELETE FROM book_subjects
      WHERE EXISTS (
        SELECT 1 FROM books b, subjects s
        WHERE b.id = book_subjects.book_id
          AND s.id = book_subjects.subject_id
          AND b.source != s.source
      )
    `)
    console.log('[db] Books table migration complete')
  }

  // On every startup: remove any lingering cross-source book_subjects links
  db.exec(`
    DELETE FROM book_subjects
    WHERE EXISTS (
      SELECT 1 FROM books b, subjects s
      WHERE b.id = book_subjects.book_id
        AND s.id = book_subjects.subject_id
        AND b.source != s.source
    )
  `)

  console.log(`Database initialized: ${DB_PATH}`)
}

// ─── Thin query helpers ───────────────────────────────────────────────────────

type Primitive = string | number | bigint | null

/* eslint-disable @typescript-eslint/no-explicit-any */
function all<T>(sql: string, ...params: Primitive[]): T[] {
  return (getDb().prepare(sql) as any).all(...params) as T[]
}
function one<T>(sql: string, ...params: Primitive[]): T | undefined {
  return (getDb().prepare(sql) as any).get(...params) as T | undefined
}
function run(sql: string, ...params: (Primitive | undefined)[]): void {
  ;(getDb().prepare(sql) as any).run(...params)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value)
}

export function getAllSettings(): Settings {
  return {
    data_path: getSetting('data_path') ?? path.join(process.cwd(), 'data'),
    last_full_update: getSetting('last_full_update') || null,
    hide_cover: getSetting('hide_cover') === 'true',
  }
}

// ─── Subjects ─────────────────────────────────────────────────────────────────

export function getAllSubjects(source?: string): Subject[] {
  const sql = `
    SELECT s.*, COUNT(bs.book_id) AS book_count
    FROM subjects s
    LEFT JOIN book_subjects bs ON bs.subject_id = s.id
    ${source ? 'WHERE s.source = ?' : ''}
    GROUP BY s.id
    ORDER BY s.name`
  return source
    ? all<Subject>(sql, source)
    : all<Subject>(sql)
}

export function upsertSubject(
  subject: Omit<Subject, 'id' | 'source' | 'last_crawled_at' | 'crawl_offset'> & { source?: Source }
): void {
  run(
    `INSERT INTO subjects (slug, name, url, book_count, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name       = excluded.name,
       url        = excluded.url,
       book_count = excluded.book_count`,
    subject.slug,
    subject.name,
    subject.url,
    subject.book_count,
    subject.source ?? 'epubbooks'
  )
}

export function updateSubjectCrawlOffset(id: number, offset: number): void {
  run('UPDATE subjects SET crawl_offset = ? WHERE id = ?', offset, id)
}

export function updateSubjectCrawledAt(slug: string): void {
  run(`UPDATE subjects SET last_crawled_at = datetime('now') WHERE slug = ?`, slug)
}

export function getExistingBookIds(subjectSlug: string, source: string): Set<string> {
  const rows = all<{ book_id: string }>(
    `SELECT b.book_id FROM books b
     JOIN book_subjects bs ON bs.book_id = b.id
     JOIN subjects s ON s.id = bs.subject_id
     WHERE s.slug = ? AND b.source = ?`,
    subjectSlug,
    source
  )
  return new Set(rows.map((r) => r.book_id))
}

// ─── Books ────────────────────────────────────────────────────────────────────

export function bookExistsInDb(source: string, bookId: string): boolean {
  return ((one<{ count: number }>('SELECT COUNT(*) AS count FROM books WHERE source = ? AND book_id = ?', source, bookId) ?? { count: 0 }).count) > 0
}

export function upsertBook(
  book: Omit<Book, 'id' | 'source' | 'first_seen_at' | 'updated_at' | 'local_path' | 'downloaded_at'> & { source?: Source }
): boolean {
  const src = book.source ?? 'epubbooks'
  const isNew = !bookExistsInDb(src, book.book_id)
  run(
    `INSERT INTO books
       (source, book_id, title, author, subject_slug, cover_url, book_url, download_url, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, book_id) DO UPDATE SET
       title        = excluded.title,
       author       = excluded.author,
       cover_url    = excluded.cover_url,
       book_url     = excluded.book_url,
       download_url = excluded.download_url,
       description  = excluded.description,
       updated_at   = datetime('now')`,
    src,
    book.book_id,
    book.title,
    book.author,
    book.subject_slug,
    book.cover_url ?? null,
    book.book_url,
    book.download_url ?? null,
    book.description ?? null
  )
  // Add book-subject relationship
  const bookRow = one<{ id: number }>('SELECT id FROM books WHERE source = ? AND book_id = ?', src, book.book_id)
  const subjectRow = one<{ id: number }>('SELECT id FROM subjects WHERE slug = ? AND source = ?', book.subject_slug, src)
  if (bookRow && subjectRow) {
    run('INSERT OR IGNORE INTO book_subjects (book_id, subject_id) VALUES (?, ?)', bookRow.id, subjectRow.id)
  }
  return isNew
}

export function getBook(id: number): Book | null {
  return one<Book>('SELECT * FROM books WHERE id = ?', id) ?? null
}

export function updateBookDownload(id: number, localPath: string): void {
  run(
    `UPDATE books
     SET local_path = ?, downloaded_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    localPath,
    id
  )
}

export function clearBookDownload(id: number): void {
  run(
    `UPDATE books SET local_path = NULL, downloaded_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    id
  )
}

export function searchBooks(query: BooksQuery): {
  books: Book[]
  total: number
  page: number
  limit: number
} {
  const page = Math.max(1, parseInt(query.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '40', 10)))
  const offset = (page - 1) * limit

  const ftsQuery = query.q ? buildFts5Query(query.q) : ''
  const useFts = Boolean(ftsQuery)

  const filterConds: string[] = []
  const filterParams: Primitive[] = []
  const prefix = useFts ? 'b.' : ''

  if (query.source) {
    filterConds.push(`${prefix}source = ?`)
    filterParams.push(query.source)
  }
  if (query.subject) {
    filterConds.push(
      `${prefix}id IN (SELECT bs.book_id FROM book_subjects bs JOIN subjects s ON s.id = bs.subject_id WHERE s.slug = ?)`
    )
    filterParams.push(query.subject)
  }
  if (query.downloaded === 'true') {
    filterConds.push(`${prefix}local_path IS NOT NULL`)
  } else if (query.downloaded === 'false') {
    filterConds.push(`${prefix}local_path IS NULL`)
  }

  const filterWhere = filterConds.length ? `WHERE ${filterConds.join(' AND ')}` : ''

  let total: number
  let books: Book[]

  if (useFts) {
    const ftsJoin = `JOIN (SELECT rowid, rank FROM books_fts WHERE books_fts MATCH ?) fts ON b.id = fts.rowid`
    const ftsWhere = filterConds.length ? `WHERE ${filterConds.join(' AND ')}` : ''

    total =
      (
        one<{ count: number }>(
          `SELECT COUNT(*) AS count FROM books b ${ftsJoin} ${ftsWhere}`,
          ftsQuery,
          ...filterParams
        ) ?? { count: 0 }
      ).count

    books = all<Book>(
      `SELECT b.* FROM books b ${ftsJoin} ${ftsWhere} ORDER BY fts.rank LIMIT ? OFFSET ?`,
      ftsQuery,
      ...filterParams,
      limit,
      offset
    )
  } else {
    total =
      (
        one<{ count: number }>(`SELECT COUNT(*) AS count FROM books ${filterWhere}`, ...filterParams) ??
        { count: 0 }
      ).count

    books = all<Book>(
      `SELECT * FROM books ${filterWhere} ORDER BY first_seen_at DESC LIMIT ? OFFSET ?`,
      ...filterParams,
      limit,
      offset
    )
  }

  return { books, total, page, limit }
}

export function getStats(source?: string): { total: number; downloaded: number } {
  const total = source
    ? (one<{ count: number }>('SELECT COUNT(*) AS count FROM books WHERE source = ?', source) ?? { count: 0 }).count
    : (one<{ count: number }>('SELECT COUNT(*) AS count FROM books') ?? { count: 0 }).count
  const downloaded = source
    ? (one<{ count: number }>('SELECT COUNT(*) AS count FROM books WHERE source = ? AND local_path IS NOT NULL', source) ?? { count: 0 }).count
    : (one<{ count: number }>('SELECT COUNT(*) AS count FROM books WHERE local_path IS NOT NULL') ?? { count: 0 }).count
  return { total, downloaded }
}

export function syncDownloadedStatus(): { cleared: number } {
  const books = all<{ id: number; local_path: string }>(
    'SELECT id, local_path FROM books WHERE local_path IS NOT NULL'
  )
  let cleared = 0
  for (const book of books) {
    if (!fs.existsSync(book.local_path)) {
      run(`UPDATE books SET local_path = NULL, downloaded_at = NULL, updated_at = datetime('now') WHERE id = ?`, book.id)
      cleared++
    }
  }
  return { cleared }
}
