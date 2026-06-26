import type { Book, BooksResponse, Subject, AppSettings } from '../types'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  books: {
    list: (params: Record<string, string> = {}): Promise<BooksResponse> => {
      const qs = new URLSearchParams(params).toString()
      return request<BooksResponse>(`/books${qs ? `?${qs}` : ''}`)
    },
    stats: (source?: string): Promise<{ total: number; downloaded: number }> => {
      const qs = source ? `?source=${source}` : ''
      return request<{ total: number; downloaded: number }>(`/books/stats${qs}`)
    },
    get: (id: number): Promise<Book> => request<Book>(`/books/${id}`),
    download: (id: number): Promise<{ local_path: string; cached?: boolean }> =>
      request(`/books/${id}/download`, { method: 'POST' }),
    deleteDownload: (id: number): Promise<{ deleted: boolean }> =>
      request(`/books/${id}/download`, { method: 'DELETE' }),
  },

  subjects: {
    list: (source?: string): Promise<Subject[]> => {
      const qs = source ? `?source=${source}` : ''
      return request<Subject[]>(`/subjects${qs}`)
    },
  },

  index: {
    update: (source?: string, force?: boolean, subject?: string): Promise<{ status: string }> => {
      const params = new URLSearchParams()
      if (source) params.set('source', source)
      if (force) params.set('force', 'true')
      if (subject) params.set('subject', subject)
      const qs = params.toString()
      return request(`/index/update${qs ? `?${qs}` : ''}`, { method: 'POST' })
    },
    statusStream: (): EventSource => new EventSource(`${BASE}/index/status`),
  },

  settings: {
    get: (): Promise<AppSettings> => request<AppSettings>('/settings'),
    update: (data: Partial<AppSettings>): Promise<AppSettings> =>
      request('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
  },
}
