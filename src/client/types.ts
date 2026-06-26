export type Source = 'epubbooks' | 'gutenberg'

export interface Book {
  id: number
  source: Source
  book_id: string
  title: string
  author: string
  subject_slug: string
  cover_url: string | null
  book_url: string
  description: string | null
  local_path: string | null
  downloaded_at: string | null
  first_seen_at: string
}

export interface Subject {
  id: number
  source: Source
  slug: string
  name: string
  book_count: number
  last_crawled_at: string | null
  crawl_offset: number
}

export interface BooksResponse {
  books: Book[]
  total: number
  page: number
  limit: number
}

export interface IndexUpdateEvent {
  type: 'crawling' | 'start' | 'subject' | 'book' | 'complete' | 'batch_limit' | 'error'
  totalSubjects?: number
  name?: string
  done?: number
  total?: number
  title?: string
  new?: boolean
  added?: number
  skipped?: number
  hasMore?: boolean
  message?: string
}

export interface AppSettings {
  data_path: string
  last_full_update: string | null
  hide_cover: boolean
}
