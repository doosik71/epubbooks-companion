import { Router } from 'express'
import { getAllSettings, setSetting } from '../services/database'

const router = Router()

// GET /api/settings
router.get('/', (_req, res) => {
  try {
    res.json(getAllSettings())
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// PUT /api/settings
router.put('/', (req, res) => {
  try {
    const { data_path } = req.body as { data_path?: string }
    if (data_path !== undefined) {
      setSetting('data_path', data_path)
    }
    res.json(getAllSettings())
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export default router
