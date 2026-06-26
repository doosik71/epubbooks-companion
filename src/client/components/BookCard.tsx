import { useState } from 'react'
import { api } from '../api/client'
import type { Book } from '../types'

interface BookCardProps {
  book: Book
  onDownloaded: (localPath: string) => void
}

export default function BookCard({ book, onDownloaded }: BookCardProps) {
  const [imgError, setImgError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dlError, setDlError] = useState('')

  const isDownloaded = Boolean(book.local_path)

  const handleDownload = async () => {
    setDownloading(true)
    setDlError('')
    try {
      const result = await api.books.download(book.id)
      onDownloaded(result.local_path)
    } catch (err) {
      setDlError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className={`bg-white rounded-lg overflow-hidden flex flex-col transition-shadow hover:shadow-md border ${
        isDownloaded ? 'border-green-200 shadow-sm' : 'border-gray-200 shadow-sm'
      }`}
    >
      {/* Cover */}
      <div className="h-44 bg-gray-100 relative overflow-hidden">
        {!imgError && book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-50 to-gray-100">
            <svg
              className="w-12 h-12 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
        )}
        {isDownloaded && (
          <div className="absolute top-1.5 right-1.5 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-tight">
            ✓ Saved
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 pt-2.5 pb-1 flex flex-col gap-0.5 flex-1 min-h-0">
        <h3
          className="text-xs font-semibold text-gray-900 line-clamp-2 leading-snug"
          title={book.title}
        >
          {book.title}
        </h3>
        <p className="text-xs text-gray-500 truncate" title={book.author}>
          {book.author}
        </p>
        <p className="text-[10px] text-gray-400 mt-auto pt-1 truncate capitalize">
          {book.subject_slug.replace(/_/g, ' ')}
        </p>
      </div>

      {/* Action */}
      <div className="px-3 pb-3 pt-1">
        {isDownloaded ? (
          <div className="text-xs text-green-600 font-medium text-center py-1.5">
            ✓ Saved to disk
          </div>
        ) : dlError ? (
          <div className="space-y-1.5">
            <p className="text-[10px] text-red-500 line-clamp-2" title={dlError}>
              {dlError}
            </p>
            <div className="flex gap-1">
              <button
                onClick={handleDownload}
                className="flex-1 text-xs py-1.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
              >
                Retry
              </button>
              <a
                href={book.book_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs py-1.5 text-center border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50 transition-colors"
                title="Open on epubbooks.com"
              >
                Open ↗
              </a>
            </div>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
          >
            {downloading ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Downloading…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 8l-3-3m3 3l3-3" />
                </svg>
                Download
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
