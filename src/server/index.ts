import express from 'express'
import cors from 'cors'
import path from 'path'
import { initDatabase } from './services/database'
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

if (process.env.NODE_ENV === 'production') {
  const clientDir = path.join(__dirname, '../../dist/client')
  app.use(express.static(clientDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

initDatabase()

app.listen(PORT, () => {
  console.log(`epubbooks companion server running at http://localhost:${PORT}`)
})

export default app
