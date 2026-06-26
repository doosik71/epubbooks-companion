import { Router } from 'express'

const router = Router()

// GET /api/settings
router.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// PUT /api/settings
router.put('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

export default router
