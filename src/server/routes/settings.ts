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
    const { data_path, hide_cover } = req.body as { data_path?: string; hide_cover?: boolean }
    if (data_path !== undefined) setSetting('data_path', data_path)
    if (hide_cover !== undefined) setSetting('hide_cover', hide_cover ? 'true' : 'false')
    res.json(getAllSettings())
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export default router
