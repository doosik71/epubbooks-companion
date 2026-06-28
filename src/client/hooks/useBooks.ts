import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { BooksResponse } from '../types'

interface UseBooksOptions {
  q: string
  subject: string
  source: string
}

export function useBooks({ q, subject, source }: UseBooksOptions) {
  const [data, setData] = useState<BooksResponse>({ books: [], total: 0, page: 1, limit: 200 })
  const [stats, setStats] = useState<{ total: number; downloaded: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const fetchIdRef = useRef(0)

  const fetchStats = useCallback(() => {
    api.books.stats(source).then(setStats).catch(console.error)
  }, [source])

  const fetchBooks = useCallback(() => {
    const id = ++fetchIdRef.current
    setIsLoading(true)

    const params: Record<string, string> = { limit: '2000', page: '1' }
    if (q) params.q = q
    if (subject) params.subject = subject
    if (source) params.source = source

    api.books
      .list(params)
      .then((result) => {
        if (id === fetchIdRef.current) {
          setData(result)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (id === fetchIdRef.current) setIsLoading(false)
      })
  }, [q, subject, source])

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const updateBook = useCallback((id: number, localPath: string) => {
    setData((prev) => ({
      ...prev,
      books: prev.books.map((b) =>
        b.id === id
          ? { ...b, local_path: localPath, downloaded_at: new Date().toISOString() }
          : b
      ),
    }))
    setStats((prev) => (prev ? { ...prev, downloaded: prev.downloaded + 1 } : prev))
  }, [])

  const deleteBook = useCallback((id: number) => {
    setData((prev) => ({
      ...prev,
      books: prev.books.map((b) =>
        b.id === id ? { ...b, local_path: null, downloaded_at: null } : b
      ),
    }))
    setStats((prev) => (prev ? { ...prev, downloaded: Math.max(0, prev.downloaded - 1) } : prev))
  }, [])

  const refetch = useCallback(() => {
    fetchBooks()
    fetchStats()
  }, [fetchBooks, fetchStats])

  return { ...data, stats, isLoading, updateBook, deleteBook, refetch }
}
