import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { BooksResponse } from '../types'

interface UseBooksOptions {
  q: string
  subject: string
}

export function useBooks({ q, subject }: UseBooksOptions) {
  const [data, setData] = useState<BooksResponse>({ books: [], total: 0, page: 1, limit: 200 })
  const [stats, setStats] = useState<{ total: number; downloaded: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const fetchIdRef = useRef(0)

  const fetchStats = useCallback(() => {
    api.books.stats().then(setStats).catch(console.error)
  }, [])

  const fetchBooks = useCallback(() => {
    const id = ++fetchIdRef.current
    setIsLoading(true)

    const params: Record<string, string> = { limit: '500', page: '1' }
    if (q) params.q = q
    if (subject) params.subject = subject

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
  }, [q, subject])

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Optimistic update after a successful download
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

  const refetch = useCallback(() => {
    fetchBooks()
    fetchStats()
  }, [fetchBooks, fetchStats])

  return { ...data, stats, isLoading, updateBook, refetch }
}
