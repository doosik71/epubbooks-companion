import axios from 'axios'
import * as cheerio from 'cheerio'
import {
  getAllSubjects,
  upsertSubject,
  upsertBook,
  updateSubjectCrawledAt,
  updateSubjectCrawlOffset,
  bookExistsInDb,
  setSetting,
} from './database'
import type { IndexUpdateEvent } from '../types'

const BASE = 'https://www.gutenberg.org'
const DELAY_MS = 600
const PAGE_SIZE = 25         // Gutenberg shows 25 books per bookshelf page
const BATCH_LIMIT = 1000     // max new books to index per run
const STALE_MS = 7 * 24 * 60 * 60 * 1000  // 7 days before re-crawling exhausted bookshelves

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

// ── Categories ────────────────────────────────────────────────────────────────

async function fetchBookshelfList() {
  const res = await http.get<string>('/ebooks/categories')
  const $ = cheerio.load(res.data)

  const seen = new Set<string>()
  const bookshelves: Array<{ slug: string; name: string; url: string; book_count: number }> = []

  $('a[href*="/ebooks/bookshelf/"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/\/ebooks\/bookshelf\/(\d+)/)
    if (!m) return

    const id = m[1]
    const slug = `g_${id}`
    if (seen.has(slug)) return
    seen.add(slug)

    const text = $(el).text().trim()
    const countMatch = text.match(/\(([\d,]+)\)\s*$/)
    const name = text.replace(/\s*\([\d,]+\)\s*$/, '').trim()
    const book_count = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : 0

    if (!name) return
    bookshelves.push({ slug, name, url: `${BASE}/ebooks/bookshelf/${id}`, book_count })
  })

  return bookshelves
}

// ── Bookshelf page ────────────────────────────────────────────────────────────

interface RawBook {
  book_id: string
  title: string
  author: string
  book_url: string
  cover_url: string
  download_url: string
}

async function fetchBookshelfPage(
  shelfUrl: string,
  startIndex: number
): Promise<{ books: RawBook[]; count: number }> {
  const url = `${shelfUrl}?start_index=${startIndex}`
  const res = await http.get<string>(url)
  const $ = cheerio.load(res.data)
  const books: RawBook[] = []

  $('li.booklink').each((_, el) => {
    const link = $(el).find('a.link, a').first()
    const href = link.attr('href') ?? ''
    const idMatch = href.match(/\/ebooks\/(\d+)$/)
    if (!idMatch) return

    const id = idMatch[1]
    const title =
      $(el).find('.title').text().trim() ||
      link.clone().children().remove().end().text().trim() ||
      link.text().trim()
    const author = $(el).find('.subtitle').text().trim()

    if (!title) return
    books.push({
      book_id: id,
      title,
      author: author || '',
      book_url: `${BASE}/ebooks/${id}`,
      cover_url: `${BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`,
      download_url: `${BASE}/ebooks/${id}.epub.images`,
    })
  })

  return { books, count: books.length }
}

// ── Main update ───────────────────────────────────────────────────────────────

function shouldRecrawl(lastCrawledAt: string | null): boolean {
  if (!lastCrawledAt) return true
  return Date.now() - new Date(lastCrawledAt).getTime() > STALE_MS
}

export async function runGutenbergUpdate(
  emit: (event: IndexUpdateEvent) => void,
  options: { force?: boolean } = {}
): Promise<void> {
  // 1. Fetch all bookshelves and upsert into subjects
  emit({ type: 'start', totalSubjects: 0 })
  const bookshelves = await fetchBookshelfList()
  for (const bs of bookshelves) {
    upsertSubject({ slug: bs.slug, name: bs.name, url: bs.url, book_count: bs.book_count, source: 'gutenberg' })
  }

  // 2. Select bookshelves to crawl this run
  const allSubjects = getAllSubjects('gutenberg')

  // force=true: reset all offsets so we re-scan from the beginning of each bookshelf
  if (options.force) {
    for (const s of allSubjects) {
      updateSubjectCrawlOffset(s.id, 0)
    }
  }

  // Include: never-exhausted (last_crawled_at === null, i.e. still in progress or untouched)
  //          OR exhausted but stale (7+ days) after force reset their offset is now 0
  const pending = options.force
    ? allSubjects.map((s) => ({ ...s, crawl_offset: 0 }))
    : allSubjects.filter((s) => s.last_crawled_at === null || shouldRecrawl(s.last_crawled_at))

  emit({ type: 'start', totalSubjects: pending.length })

  if (pending.length === 0) {
    emit({ type: 'complete', added: 0, skipped: 0 })
    return
  }

  let totalAdded = 0
  let totalSkipped = 0
  let subjectsDone = 0

  for (const subject of pending) {
    if (totalAdded >= BATCH_LIMIT) break

    subjectsDone++
    emit({ type: 'subject', name: subject.name, done: subjectsDone, total: pending.length })

    // Start from where we left off (crawl_offset = number of books already fetched)
    let offset = subject.crawl_offset
    let pageCount = PAGE_SIZE  // assume full page to start loop

    try {
      while (pageCount >= PAGE_SIZE && totalAdded < BATCH_LIMIT) {
        await sleep(DELAY_MS)
        const startIndex = offset + 1  // Gutenberg uses 1-based start_index
        const { books, count } = await fetchBookshelfPage(subject.url, startIndex)
        pageCount = count

        for (const book of books) {
          if (bookExistsInDb(book.book_id)) {
            totalSkipped++
          } else {
            upsertBook({
              source: 'gutenberg',
              book_id: book.book_id,
              title: book.title,
              author: book.author,
              subject_slug: subject.slug,
              cover_url: book.cover_url,
              book_url: book.book_url,
              download_url: book.download_url,
              description: null,
            })
            totalAdded++
            emit({ type: 'book', title: book.title, new: true })
          }
        }

        offset += count
        updateSubjectCrawlOffset(subject.id, offset)

        // Reached the last page of this bookshelf
        if (count < PAGE_SIZE) {
          updateSubjectCrawledAt(subject.slug)
          break
        }
      }
    } catch (err) {
      emit({ type: 'error', message: `[${subject.name}] ${String(err)}` })
    }
  }

  setSetting('last_full_update', new Date().toISOString())

  if (totalAdded >= BATCH_LIMIT) {
    emit({ type: 'batch_limit', added: totalAdded, skipped: totalSkipped, hasMore: true })
  } else {
    emit({ type: 'complete', added: totalAdded, skipped: totalSkipped })
  }
}
