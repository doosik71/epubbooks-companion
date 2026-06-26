import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { initDatabase, syncDownloadedStatus, getStats } from './services/database'
import booksRouter from './routes/books'
import indexUpdateRouter from './routes/index-update'
import subjectsRouter from './routes/subjects'
import settingsRouter from './routes/settings'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(cors())
app.use(express.json())

app.use('/api/books', booksRouter)
app.use('/api/subjects', subjectsRouter)
app.use('/api/index', indexUpdateRouter)
app.use('/api/settings', settingsRouter)

// Serve the built React app when dist/client exists (after npm run build)
const clientDir = path.join(process.cwd(), 'dist', 'client')
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

initDatabase()

// Clear stale local_path references for files deleted outside the app
const { cleared } = syncDownloadedStatus()
const stats = getStats()

app.listen(PORT, () => {
  console.log(`epubbooks companion  ->  http://localhost:${PORT}`)
  console.log(
    `[db] ${stats.total.toLocaleString()} books, ${stats.downloaded} downloaded` +
    (cleared > 0 ? `, ${cleared} stale paths cleared` : '')
  )
  if (!fs.existsSync(clientDir)) {
    console.log('[info] run "npm run build" to enable the web UI')
  }
})

export default app
