import { Router } from 'express'
import { getAllSubjects } from '../services/database'

const router = Router()

router.get('/', (req, res) => {
  try {
    const source = req.query['source'] as string | undefined
    res.json(getAllSubjects(source))
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export default router
