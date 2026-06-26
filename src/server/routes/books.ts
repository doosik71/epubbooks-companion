import { Router } from 'express'

const router = Router()

// GET /api/books?q=&subject=&downloaded=&page=&limit=
router.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// GET /api/books/:id
router.get('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// POST /api/books/:id/download
router.post('/:id/download', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

export default router
