import { Router } from 'express'
import { getAllSubjects } from '../services/database'

const router = Router()

router.get('/', (_req, res) => {
  try {
    res.json(getAllSubjects())
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export default router
