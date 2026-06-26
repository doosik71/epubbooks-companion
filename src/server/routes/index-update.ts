import { Router } from 'express'

const router = Router()

// POST /api/index/update  — 인덱스 갱신 시작
router.post('/update', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// GET /api/index/status  — SSE 진행 상태 스트림
router.get('/status', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write('data: {"type":"error","message":"Not implemented"}\n\n')
  res.end()
})

export default router
