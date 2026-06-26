import { Router } from 'express'
import axios from 'axios'
import * as cheerio from 'cheerio'
import fs from 'fs'
import {
  searchBooks,
  getBook,
  updateBookDownload,
  clearBookDownload,
  getAllSettings,
  getStats,
} from '../services/database'
import { resolveUniqueLocalPath, writeEpub } from '../services/storage'
import type { BooksQuery } from '../types'

const router = Router()
const BASE = 'https://www.epubbooks.com'

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
}

// Merge cookie strings, later values override earlier ones with the same key
function mergeCookies(base: string, extra: string): string {
  const map = new Map<string, string>()
  for (const raw of [base, extra]) {
    for (const part of raw.split('; ')) {
      const name = part.split('=')[0].trim()
      if (name) map.set(name, part)
    }
  }
  return Array.from(map.values()).join('; ')
}

function extractSetCookies(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie']
  if (!raw) return ''
  const arr = Array.isArray(raw) ? raw : [String(raw)]
  return arr.map((c) => c.split(';')[0].trim()).join('; ')
}

// GET /api/books/stats?source= — total and downloaded counts (must be before /:id)
router.get('/stats', (req, res) => {
  try {
    const source = req.query['source'] as string | undefined
    res.json(getStats(source))
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/books?q=&subject=&downloaded=&page=&limit=
router.get('/', (req, res) => {
  try {
    res.json(searchBooks(req.query as BooksQuery))
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/books/:id
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return }
  const book = getBook(id)
  if (!book) { res.status(404).json({ error: 'Not found' }); return }
  res.json(book)
})

// POST /api/books/:id/download
router.post('/:id/download', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return }

  const book = getBook(id)
  if (!book) { res.status(404).json({ error: 'Not found' }); return }

  // Return cached path if already downloaded and file still exists on disk
  if (book.local_path) {
    if (fs.existsSync(book.local_path)) {
      res.json({ local_path: book.local_path, cached: true })
      return
    }
    // File was deleted externally — clear stale reference and re-download
    clearBookDownload(id)
  }

  try {
    const fileBuffer = book.source === 'gutenberg'
      ? await downloadGutenberg(book)
      : await downloadEpubBooks(book)

    const settings = getAllSettings()
    const localPath = resolveUniqueLocalPath(settings.data_path, book.author, book.title)
    writeEpub(localPath, fileBuffer)
    updateBookDownload(id, localPath)
    res.json({ local_path: localPath })
  } catch (err) {
    console.error('[download]', String(err))
    res.status(500).json({ error: String(err), book_url: book.book_url })
  }
})

async function downloadGutenberg(book: { book_id: string; download_url: string | null; book_url: string }): Promise<Buffer> {
  const url = book.download_url ?? `https://www.gutenberg.org/ebooks/${book.book_id}.epub.images`
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': BROWSER_HEADERS['User-Agent'],
      Accept: 'application/epub+zip, application/octet-stream, */*;q=0.8',
    },
    timeout: 60_000,
    maxRedirects: 10,
  })
  const ct = (res.headers['content-type'] as string) ?? ''
  if (ct.includes('text/html')) {
    throw new Error('[gutenberg] Server returned HTML — epub may not be available for this book')
  }
  return Buffer.from(res.data)
}

async function downloadEpubBooks(book: { book_url: string }): Promise<Buffer> {
  // ── Step 1: Fetch book page ─────────────────────────────────────────────
  let jar = ''
  const pageRes = await axios.get<string>(book.book_url, {
    headers: { ...BROWSER_HEADERS },
    timeout: 30_000,
  })
  jar = mergeCookies(jar, extractSetCookies(pageRes.headers as Record<string, unknown>))

  const $ = cheerio.load(pageRes.data)
  const dlid = $('button#getDownloadId[data-dlid]').first().attr('data-dlid')
  if (!dlid) throw new Error('[step1] Download button not found on book page')

  const csrfToken = $('meta[name="csrf-token"]').attr('content') ?? ''

  // ── Step 2: Request time-limited download token ─────────────────────────
  const postHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    'Content-Type': 'application/json',
    Cookie: jar,
    Referer: book.book_url,
    Origin: BASE,
    'X-Requested-With': 'XMLHttpRequest',
  }
  if (csrfToken) postHeaders['X-CSRF-Token'] = csrfToken

  const tokenRes = await axios.post<unknown>(
    `${BASE}/downloads`,
    JSON.stringify({ id: parseInt(dlid, 10) }),
    { headers: postHeaders, timeout: 15_000 }
  )
  jar = mergeCookies(jar, extractSetCookies(tokenRes.headers as Record<string, unknown>))

  const tokenData =
    typeof tokenRes.data === 'string' ? JSON.parse(tokenRes.data) : tokenRes.data
  if (!tokenData?.id) throw new Error('[step2] Invalid token response from server')

  console.log(`[download] token=${tokenData.id} jar="${jar}"`)

  // ── Step 3: Download the epub file ──────────────────────────────────────
  const fileRes = await axios.get<ArrayBuffer>(
    `${BASE}/downloads/${tokenData.id}/file`,
    {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: 'application/epub+zip, application/octet-stream, */*;q=0.8',
        'Accept-Language': BROWSER_HEADERS['Accept-Language'],
        Cookie: jar,
        Referer: book.book_url,
      },
      timeout: 60_000,
      maxRedirects: 5,
    }
  )

  const ct = (fileRes.headers['content-type'] as string) ?? ''
  if (ct.includes('text/html')) {
    throw new Error('[step3] Server returned an HTML error page instead of the epub file')
  }
  return Buffer.from(fileRes.data)
}

// DELETE /api/books/:id/download — remove file from disk and clear DB reference
router.delete('/:id/download', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return }

  const book = getBook(id)
  if (!book) { res.status(404).json({ error: 'Not found' }); return }

  if (book.local_path && fs.existsSync(book.local_path)) {
    fs.unlinkSync(book.local_path)
  }
  clearBookDownload(id)
  res.json({ deleted: true })
})

export default router
