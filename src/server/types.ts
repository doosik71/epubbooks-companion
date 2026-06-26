export interface Book {
  id: number
  book_id: string
  title: string
  author: string
  subject_slug: string
  cover_url: string | null
  book_url: string
  download_url: string | null
  description: string | null
  local_path: string | null
  downloaded_at: string | null
  first_seen_at: string
  updated_at: string
}

export interface Subject {
  id: number
  slug: string
  name: string
  url: string
  book_count: number
  last_crawled_at: string | null
}

export interface Settings {
  data_path: string
  last_full_update: string | null
}

export interface BooksQuery {
  q?: string
  subject?: string
  downloaded?: string
  page?: string
  limit?: string
}

export interface IndexUpdateEvent {
  type: 'start' | 'subject' | 'book' | 'complete' | 'error'
  totalSubjects?: number
  name?: string
  done?: number
  total?: number
  title?: string
  new?: boolean
  added?: number
  skipped?: number
  message?: string
}
