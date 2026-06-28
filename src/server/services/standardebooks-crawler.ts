import axios from 'axios'
import * as cheerio from 'cheerio'
import {
  getAllSubjects,
  upsertSubject,
  upsertBook,
  updateSubjectCrawledAt,
  updateSubjectCrawlOffset,
  setSetting,
} from './database'
import type { IndexUpdateEvent } from '../types'

const BASE = 'https://standardebooks.org'
const DELAY_MS = 1500      // site is slow; be polite
const PER_PAGE = 48
const BATCH_LIMIT = 500
const STALE_MS = 7 * 24 * 60 * 60 * 1000

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

// Standard Ebooks has 19 fixed curated subjects
const SE_SUBJECTS = [
  { slug: 'se_adventure',       name: 'Adventure',        urlSlug: 'adventure' },
  { slug: 'se_autobiography',   name: 'Autobiography',    urlSlug: 'autobiography' },
  { slug: 'se_biography',       name: 'Biography',        urlSlug: 'biography' },
  { slug: 'se_childrens',       name: "Children's",       urlSlug: 'childrens' },
  { slug: 'se_comedy',          name: 'Comedy',           urlSlug: 'comedy' },
  { slug: 'se_drama',           name: 'Drama',            urlSlug: 'drama' },
  { slug: 'se_fantasy',         name: 'Fantasy',          urlSlug: 'fantasy' },
  { slug: 'se_fiction',         name: 'Fiction',          urlSlug: 'fiction' },
  { slug: 'se_horror',          name: 'Horror',           urlSlug: 'horror' },
  { slug: 'se_memoir',          name: 'Memoir',           urlSlug: 'memoir' },
  { slug: 'se_mystery',         name: 'Mystery',          urlSlug: 'mystery' },
  { slug: 'se_nonfiction',      name: 'Nonfiction',       urlSlug: 'nonfiction' },
  { slug: 'se_philosophy',      name: 'Philosophy',       urlSlug: 'philosophy' },
  { slug: 'se_poetry',          name: 'Poetry',           urlSlug: 'poetry' },
  { slug: 'se_satire',          name: 'Satire',           urlSlug: 'satire' },
  { slug: 'se_science-fiction', name: 'Science Fiction',  urlSlug: 'science-fiction' },
  { slug: 'se_shorts',          name: 'Shorts',           urlSlug: 'shorts' },
  { slug: 'se_spirituality',    name: 'Spirituality',     urlSlug: 'spirituality' },
  { slug: 'se_travel',          name: 'Travel',           urlSlug: 'travel' },
]

interface RawBook {
  book_id: string
  title: string
  author: string
  book_url: string
  cover_url: string
  download_url: string
}

async function fetchSubjectPage(
  urlSlug: string,
  page: number
): Promise<{ books: RawBook[]; rawCount: number; totalPages: number }> {
  const url = `/subjects/${urlSlug}?per-page=${PER_PAGE}&page=${page}`
  const res = await http.get<string>(url)
  const $ = cheerio.load(res.data)
  const books: RawBook[] = []
  let rawCount = 0

  $('li[typeof="schema:Book"][about]').each((_, el) => {
    rawCount++
    const about = $(el).attr('about') ?? ''
    if (!about.startsWith('/ebooks/')) return

    // book_path e.g. "jules-verne/around-the-world-in-eighty-days/george-makepeace-towle"
    const book_path = about.slice('/ebooks/'.length)
    const book_path_underscored = book_path.replace(/\//g, '_')

    const title = $(el).find('[property="schema:name"]').first().text().trim()
    const author =
      $(el).find('p.author a').first().text().trim() ||
      $(el).find('[typeof="schema:Person"] a').first().text().trim()
    const imgSrc = $(el).find('img').first().attr('src') ?? ''

    if (!title || !book_path) return

    books.push({
      book_id: book_path,
      title,
      author: author || '',
      book_url: `${BASE}/ebooks/${book_path}`,
      cover_url: imgSrc ? `${BASE}${imgSrc}` : '',
      download_url: `${BASE}/ebooks/${book_path}/downloads/${book_path_underscored}.epub`,
    })
  })

  // Determine last page from pagination links — SE repeats the last page for out-of-range requests
  // so rawCount alone cannot detect end-of-subject
  let totalPages = page  // default: treat current page as last if no pagination found
  $('a[href*="page="]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/[?&]page=(\d+)/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > totalPages) totalPages = n
    }
  })

  console.log(`[standardebooks] /subjects/${urlSlug} page ${page}/${totalPages} → ${rawCount} items, ${books.length} parsed`)
  return { books, rawCount, totalPages }
}

function shouldRecrawl(lastCrawledAt: string | null): boolean {
  if (!lastCrawledAt) return true
  return Date.now() - new Date(lastCrawledAt).getTime() > STALE_MS
}

export async function runStandardEbooksUpdate(
  emit: (event: IndexUpdateEvent) => void,
  options: { force?: boolean; subject?: string } = {}
): Promise<void> {
  emit({ type: 'start', totalSubjects: 0, batchLimit: BATCH_LIMIT })

  // Upsert all subjects (idempotent)
  for (const s of SE_SUBJECTS) {
    upsertSubject({
      slug: s.slug,
      name: s.name,
      url: `${BASE}/subjects/${s.urlSlug}`,
      book_count: 0,
      source: 'standardebooks',
    })
  }

  const allSubjects = options.subject
    ? getAllSubjects('standardebooks').filter((s) => s.slug === options.subject)
    : getAllSubjects('standardebooks')

  if (options.force) {
    for (const s of allSubjects) {
      updateSubjectCrawlOffset(s.id, 0)
    }
  }

  const pending = options.force
    ? allSubjects.map((s) => ({ ...s, crawl_offset: 0 }))
    : allSubjects.filter((s) => s.last_crawled_at === null || shouldRecrawl(s.last_crawled_at))

  emit({ type: 'start', totalSubjects: pending.length, batchLimit: BATCH_LIMIT })

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

    const seSubject = SE_SUBJECTS.find((s) => s.slug === subject.slug)
    if (!seSubject) continue

    // Clamp offset: corrupt values from the infinite-loop bug must not skip real pages
    let offset = Math.min(subject.crawl_offset, Number.MAX_SAFE_INTEGER)

    try {
      while (totalAdded < BATCH_LIMIT) {
        await sleep(DELAY_MS)
        const page = Math.floor(offset / PER_PAGE) + 1
        const { books, rawCount, totalPages } = await fetchSubjectPage(seSubject.urlSlug, page)

        for (const book of books) {
          const isNew = upsertBook({
            source: 'standardebooks',
            book_id: book.book_id,
            title: book.title,
            author: book.author,
            subject_slug: subject.slug,
            cover_url: book.cover_url || null,
            book_url: book.book_url,
            download_url: book.download_url,
            description: null,
          })
          if (isNew) {
            totalAdded++
            emit({ type: 'book', title: book.title, new: true })
          } else {
            totalSkipped++
          }
        }

        offset += rawCount
        updateSubjectCrawlOffset(subject.id, offset)

        // Stop when current page is the last, or the page came back partially filled
        if (page >= totalPages || rawCount < PER_PAGE) {
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
