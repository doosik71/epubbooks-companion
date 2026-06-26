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
    get: (id: number): Promise<Book> => request<Book>(`/books/${id}`),
    download: (id: number): Promise<{ local_path: string }> =>
      request(`/books/${id}/download`, { method: 'POST' }),
  },

  subjects: {
    list: (): Promise<Subject[]> => request<Subject[]>('/subjects'),
  },

  index: {
    update: (): Promise<void> => request('/index/update', { method: 'POST' }),
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
