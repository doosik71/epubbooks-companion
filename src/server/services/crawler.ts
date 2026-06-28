import axios from 'axios'
import * as cheerio from 'cheerio'
import {
  getAllSubjects,
  upsertSubject,
  upsertBook,
  updateSubjectCrawledAt,
  getExistingBookIds,
  setSetting,
} from './database'
import type { IndexUpdateEvent } from '../types'

const BASE = 'https://www.epubbooks.com'
const DELAY_MS = 700            // ms between page requests
const THRESHOLD_MS = 24 * 60 * 60 * 1000  // 24h before re-crawling a subject
const CONCURRENCY = 3           // max parallel subjects
const BATCH_LIMIT = 500         // max new books to index per run

const http = axios.create({
  baseURL: BASE,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  },
  timeout: 30_000,
})

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function extractBookId(url: string): string {
  return url.match(/\/book\/(\d+)/)?.[1] ?? url
}

function thumbToFull(src: string): string {
  return src.replace(/_thumb(\.jpg)$/, '$1')
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

interface RawSubject {
  slug: string
  name: string
  url: string
  book_count: number
}

async function fetchSubjectList(): Promise<RawSubject[]> {
  const res = await http.get<string>('/subjects')
  const $ = cheerio.load(res.data)
  const subjects: RawSubject[] = []

  $('a[href^="/subject/"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const slugMatch = href.match(/^\/subject\/([^?#/]+)$/)
    if (!slugMatch) return
    const slug = slugMatch[1]
    const text = $(el).find('h4').text().trim()
    const m = text.match(/^(.+?)\s*\((\d+)\)$/)
    if (!m) return
    subjects.push({
      slug,
      name: m[1].trim(),
      url: `${BASE}${href}`,
      book_count: parseInt(m[2], 10),
    })
  })

  return subjects
}

interface RawBook {
  book_id: string
  title: string
  author: string
  book_url: string
  cover_url: string
  description: string
}

async function fetchSubjectPage(
  slug: string,
  page: number
): Promise<{ books: RawBook[]; hasNextPage: boolean }> {
  const path = page === 1 ? `/subject/${slug}` : `/subject/${slug}?page=${page}`
  const res = await http.get<string>(path)
  const $ = cheerio.load(res.data)
  const books: RawBook[] = []

  $('ul.media-list li.media').each((_, el) => {
    const mediaLeft = $(el).find('a.media-left')
    const bookPath = mediaLeft.attr('href') ?? ''
    if (!bookPath) return

    const thumbSrc = mediaLeft.find('img').attr('src') ?? ''
    const fullSrc = thumbSrc.startsWith('/') ? `${BASE}${thumbSrc}` : thumbSrc
    const cover_url = thumbToFull(fullSrc)

    const heading = $(el).find('h2.media-heading')
    const title = heading.find('a').first().text().trim()
    const author = heading.find('span.small').text().trim()

    const descEl = $(el).find('div.media-body > p').first().clone()
    descEl.find('a').remove()
    const description = descEl.text().trim()

    books.push({
      book_id: extractBookId(bookPath),
      title,
      author,
      book_url: `${BASE}${bookPath}`,
      cover_url,
      description,
    })
  })

  const hasNextPage = $('ul.pagination li.next:not(.disabled) a').length > 0
  return { books, hasNextPage }
}

// Fetch the book detail page and extract the epub download ID (data-dlid)
export async function fetchBookDownloadId(bookUrl: string): Promise<string | null> {
  try {
    const res = await http.get<string>(bookUrl)
    const $ = cheerio.load(res.data)
    // Prefer the EPUB button (first one with data-dlid)
    const dlid = $('button#getDownloadId[data-dlid]').first().attr('data-dlid')
    return dlid ?? null
  } catch {
    return null
  }
}

// Request a time-limited download token from the site
export async function requestDownloadToken(dlid: string): Promise<string | null> {
  try {
    const res = await http.post<string>('/downloads', JSON.stringify({ id: parseInt(dlid, 10) }), {
      headers: { 'Content-Type': 'application/json' },
    })
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    return data?.id != null ? String(data.id) : null
  } catch {
    return null
  }
}

// ─── Main Update ──────────────────────────────────────────────────────────────

function shouldCrawl(lastCrawledAt: string | null): boolean {
  if (!lastCrawledAt) return true
  return Date.now() - new Date(lastCrawledAt).getTime() > THRESHOLD_MS
}

export async function runIndexUpdate(
  emit: (event: IndexUpdateEvent) => void,
  options: { force?: boolean; subject?: string } = {}
): Promise<void> {
  // 1. Fetch and upsert the subject catalog
  emit({ type: 'start', totalSubjects: 0, batchLimit: BATCH_LIMIT })
  const rawSubjects = await fetchSubjectList()
  for (const s of rawSubjects) {
    upsertSubject({ slug: s.slug, name: s.name, url: s.url, book_count: s.book_count, source: 'epubbooks' })
  }

  const dbSubjects = options.subject
    ? getAllSubjects('epubbooks').filter((s) => s.slug === options.subject)
    : getAllSubjects('epubbooks')
  const toCrawl = options.force ? dbSubjects : dbSubjects.filter((s) => shouldCrawl(s.last_crawled_at))

  emit({ type: 'start', totalSubjects: toCrawl.length, batchLimit: BATCH_LIMIT })

  if (toCrawl.length === 0) {
    emit({ type: 'complete', added: 0, skipped: 0 })
    return
  }

  let totalAdded = 0
  let totalSkipped = 0
  let done = 0

  // 2. Process subjects with concurrency limit (queue-based)
  const queue = [...toCrawl]

  async function worker(): Promise<void> {
    while (true) {
      if (totalAdded >= BATCH_LIMIT) break

      const subject = queue.shift()
      if (!subject) break

      const subjectDone = ++done
      emit({ type: 'subject', name: subject.name, done: subjectDone, total: toCrawl.length })

      try {
        const existingIds = getExistingBookIds(subject.slug, 'epubbooks')
        let page = 1
        let hasNextPage = true

        while (hasNextPage && totalAdded < BATCH_LIMIT) {
          if (page > 1) await sleep(DELAY_MS)
          const { books, hasNextPage: next } = await fetchSubjectPage(subject.slug, page)
          hasNextPage = next

          for (const book of books) {
            if (totalAdded >= BATCH_LIMIT) break
            if (existingIds.has(book.book_id)) {
              totalSkipped++
            } else {
              upsertBook({
                source: 'epubbooks',
                book_id: book.book_id,
                title: book.title,
                author: book.author,
                subject_slug: subject.slug,
                cover_url: book.cover_url,
                book_url: book.book_url,
                download_url: null,
                description: book.description,
              })
              existingIds.add(book.book_id)
              totalAdded++
              emit({ type: 'book', title: book.title, new: true })
            }
          }

          page++
          if (hasNextPage) await sleep(DELAY_MS)
        }

        if (totalAdded < BATCH_LIMIT) {
          updateSubjectCrawledAt(subject.slug)
        }
      } catch (err) {
        emit({ type: 'error', message: `[${subject.name}] ${String(err)}` })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, toCrawl.length) }, worker)
  )

  setSetting('last_full_update', new Date().toISOString())

  if (totalAdded >= BATCH_LIMIT) {
    emit({ type: 'batch_limit', added: totalAdded, skipped: totalSkipped, hasMore: true })
  } else {
    emit({ type: 'complete', added: totalAdded, skipped: totalSkipped })
  }
}
