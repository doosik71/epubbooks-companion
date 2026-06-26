import { useRef, useMemo, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import BookCard from './BookCard'
import type { Book } from '../types'

interface BookGridProps {
  books: Book[]
  total: number
  stats: { total: number; downloaded: number } | null
  isLoading: boolean
  onBookDownloaded: (id: number, localPath: string) => void
  onBookDeleted: (id: number) => void
}

function getColumns(): number {
  if (typeof window === 'undefined') return 4
  const w = window.innerWidth
  if (w >= 1536) return 7
  if (w >= 1280) return 6
  if (w >= 1024) return 5
  if (w >= 768) return 4
  if (w >= 480) return 3
  return 2
}

function useColumns(): number {
  const [cols, setCols] = useState(getColumns)
  useEffect(() => {
    const handler = () => setCols(getColumns())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return cols
}

const CARD_HEIGHT = 268  // h-44 cover + info + button
const GAP = 12

export default function BookGrid({
  books,
  total,
  stats,
  isLoading,
  onBookDownloaded,
  onBookDeleted,
}: BookGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const cols = useColumns()

  const rows = useMemo(() => {
    const result: Book[][] = []
    for (let i = 0; i < books.length; i += cols) {
      result.push(books.slice(i, i + cols))
    }
    return result
  }, [books, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 3,
  })

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Loading books…</span>
        </div>
      </div>
    )
  }

  if (stats?.total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-5xl">📚</div>
          <p className="text-gray-700 font-medium">No books indexed yet</p>
          <p className="text-gray-400 text-sm">
            Click <strong className="text-gray-600">Update Index</strong> to crawl epubbooks.com
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Stats bar */}
      <div className="px-4 py-2 text-xs text-gray-500 bg-white border-b shrink-0 flex items-center gap-2">
        {total < (stats?.total ?? total) ? (
          <span>
            <span className="font-medium text-gray-700">{total.toLocaleString()}</span> results
          </span>
        ) : (
          <span>
            <span className="font-medium text-gray-700">{(stats?.total ?? total).toLocaleString()}</span> books
          </span>
        )}
        {(stats?.downloaded ?? 0) > 0 && (
          <span className="text-green-600">
            • <span className="font-medium">{(stats?.downloaded ?? 0).toLocaleString()}</span> downloaded
          </span>
        )}
      </div>

      {books.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-sm">No books match your search</p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto pt-4">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => (
              <div
                key={vRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: `${GAP}px`,
                  padding: `0 16px ${GAP}px`,
                }}
              >
                {rows[vRow.index].map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onDownloaded={(path) => onBookDownloaded(book.id, path)}
                    onDeleted={onBookDeleted}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
