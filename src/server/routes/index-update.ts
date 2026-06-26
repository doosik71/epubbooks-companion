import { Router, type Response } from 'express'
import { runIndexUpdate } from '../services/crawler'
import { runGutenbergUpdate } from '../services/gutenberg-crawler'
import type { IndexUpdateEvent } from '../types'

const router = Router()

// In-memory SSE client registry
const sseClients = new Set<Response>()
let crawlActive = false

function broadcast(event: IndexUpdateEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`
  const dead: Response[] = []
  for (const client of sseClients) {
    try {
      client.write(data)
    } catch {
      dead.push(client)
    }
  }
  dead.forEach((c) => sseClients.delete(c))
}

// GET /api/index/status — SSE stream for crawl progress
router.get('/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(ping)
      sseClients.delete(res)
    }
  }, 25_000)

  sseClients.add(res)

  if (crawlActive) {
    res.write(`data: ${JSON.stringify({ type: 'crawling' })}\n\n`)
  }

  req.on('close', () => {
    clearInterval(ping)
    sseClients.delete(res)
  })
})

// POST /api/index/update?source=epubbooks|gutenberg&force=true
router.post('/update', (req, res) => {
  if (crawlActive) {
    res.status(409).json({ status: 'already_running' })
    return
  }

  const source = (req.query['source'] as string) ?? 'epubbooks'
  const force = req.query['force'] === 'true'
  const subject = (req.query['subject'] as string) || undefined
  res.json({ status: 'started', source, force, subject })

  crawlActive = true
  const runner = source === 'gutenberg' ? runGutenbergUpdate : runIndexUpdate
  runner(broadcast, { force, subject })
    .catch((err) => {
      console.error('[crawler]', err)
      broadcast({ type: 'error', message: String(err) })
    })
    .finally(() => {
      crawlActive = false
    })
})

// GET /api/index/active — check if crawl is running
router.get('/active', (_req, res) => {
  res.json({ active: crawlActive })
})

export default router
