import { Router } from 'express'
import axios from 'axios'
import * as cheerio from 'cheerio'
import {
  searchBooks,
  getBook,
  updateBookDownload,
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
}

// GET /api/books/stats — total and downloaded counts (must be before /:id)
router.get('/stats', (_req, res) => {
  try {
    res.json(getStats())
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

  // Return cached path if already downloaded
  if (book.local_path) {
    res.json({ local_path: book.local_path, cached: true })
    return
  }

  try {
    // Step 1: fetch book detail page to get dlid + session cookies
    const pageRes = await axios.get<string>(book.book_url, {
      headers: { ...BROWSER_HEADERS },
      timeout: 30_000,
    })
    const cookies = ((pageRes.headers['set-cookie'] as string[] | undefined) ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')

    const $ = cheerio.load(pageRes.data)
    const dlid = $('button#getDownloadId[data-dlid]').first().attr('data-dlid')
    if (!dlid) throw new Error('Download button not found on book page')

    // Step 2: request a time-limited download token
    const tokenRes = await axios.post<unknown>(
      `${BASE}/downloads`,
      JSON.stringify({ id: parseInt(dlid, 10) }),
      {
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/json',
          Cookie: cookies,
          Referer: book.book_url,
          Origin: BASE,
        },
        timeout: 15_000,
      }
    )
    const tokenData =
      typeof tokenRes.data === 'string'
        ? JSON.parse(tokenRes.data)
        : tokenRes.data
    if (!tokenData?.id) throw new Error('Invalid token response from server')

    // Step 3: download the epub file
    const fileRes = await axios.get<ArrayBuffer>(
      `${BASE}/downloads/${tokenData.id}/file`,
      {
        responseType: 'arraybuffer',
        headers: {
          ...BROWSER_HEADERS,
          Cookie: cookies,
          Referer: book.book_url,
        },
        timeout: 60_000,
      }
    )

    const contentType = (fileRes.headers['content-type'] as string) ?? ''
    if (contentType.includes('text/html')) {
      throw new Error('Server returned an error page instead of the epub file')
    }

    // Step 4: save to disk
    const settings = getAllSettings()
    const localPath = resolveUniqueLocalPath(settings.data_path, book.author, book.title)
    writeEpub(localPath, Buffer.from(fileRes.data))
    updateBookDownload(id, localPath)

    res.json({ local_path: localPath })
  } catch (err) {
    console.error('[download]', err)
    res.status(500).json({ error: String(err), book_url: book.book_url })
  }
})

export default router
