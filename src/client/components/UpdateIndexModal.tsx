import { useEffect, useState, useRef } from 'react'
import type { IndexUpdateEvent, Source } from '../types'
import { api } from '../api/client'

interface UpdateIndexModalProps {
  source: Source
  onClose: () => void
  onComplete: () => void
}

type ModalStatus = 'connecting' | 'running' | 'done' | 'batch_limit' | 'error'

export default function UpdateIndexModal({ source, onClose, onComplete }: UpdateIndexModalProps) {
  const [status, setStatus] = useState<ModalStatus>('connecting')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [recentBooks, setRecentBooks] = useState<string[]>([])
  const [summary, setSummary] = useState<{ added: number; skipped: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const esRef = useRef<EventSource | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    const es = api.index.statusStream()
    esRef.current = es

    es.onopen = () => {
      api.index.update(source).catch(() => {})
    }

    es.onmessage = (e: MessageEvent<string>) => {
      if (!e.data || e.data.startsWith(':')) return
      let event: IndexUpdateEvent
      try {
        event = JSON.parse(e.data) as IndexUpdateEvent
      } catch {
        return
      }

      if (event.type === 'crawling') {
        setStatus('running')
      } else if (event.type === 'start') {
        setStatus('running')
        if (event.totalSubjects) setProgress((p) => ({ ...p, total: event.totalSubjects! }))
      } else if (event.type === 'subject') {
        setProgress({ done: event.done ?? 0, total: event.total ?? 0 })
      } else if (event.type === 'book' && event.new) {
        setRecentBooks((prev) => [event.title ?? '', ...prev].slice(0, 6))
      } else if (event.type === 'complete') {
        setSummary({ added: event.added ?? 0, skipped: event.skipped ?? 0 })
        setStatus('done')
        es.close()
        onCompleteRef.current()
      } else if (event.type === 'batch_limit') {
        setSummary({ added: event.added ?? 0, skipped: event.skipped ?? 0 })
        setStatus('batch_limit')
        es.close()
        onCompleteRef.current()
      } else if (event.type === 'error') {
        setErrorMsg(event.message ?? 'Unknown error')
        setStatus('error')
        es.close()
      }
    }

    return () => {
      es.close()
    }
  }, [source])

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const canClose = status === 'done' || status === 'batch_limit' || status === 'error'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Update Index</h2>
          {canClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Status text */}
          <div className="flex items-center gap-2 text-sm">
            {status === 'connecting' && (
              <>
                <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-gray-500">Connecting…</span>
              </>
            )}
            {status === 'running' && (
              <>
                <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-gray-700">
                  Crawling subjects:{' '}
                  <span className="font-medium">
                    {progress.done} / {progress.total}
                  </span>
                </span>
              </>
            )}
            {status === 'done' && (
              <span className="text-green-700 font-medium">✓ Index updated successfully</span>
            )}
            {status === 'batch_limit' && (
              <span className="text-amber-700 font-medium">⏸ Batch limit reached</span>
            )}
            {status === 'error' && (
              <span className="text-red-600 font-medium">✗ Error occurred</span>
            )}
          </div>

          {/* Progress bar */}
          {status === 'running' && (
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-500 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* Error message */}
          {status === 'error' && errorMsg && (
            <p className="text-xs text-red-500 bg-red-50 rounded p-2">{errorMsg}</p>
          )}

          {/* Batch limit notice */}
          {status === 'batch_limit' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              1,000 books indexed this run. Click <strong>Update Index</strong> again to continue indexing more books.
            </p>
          )}

          {/* Recent new books */}
          {recentBooks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                New books found
              </p>
              {recentBooks.map((title, i) => (
                <p key={i} className="text-xs text-gray-600 truncate">
                  + {title}
                </p>
              ))}
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className={`border rounded-lg p-3 ${status === 'batch_limit' ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-sm font-semibold ${status === 'batch_limit' ? 'text-amber-700' : 'text-green-700'}`}>
                {summary.added.toLocaleString()} new book{summary.added !== 1 ? 's' : ''} added
              </p>
              <p className={`text-xs mt-0.5 ${status === 'batch_limit' ? 'text-amber-600' : 'text-green-600'}`}>
                {summary.skipped.toLocaleString()} already in index
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {canClose && (
          <div className="px-5 pb-5">
            <button
              onClick={onClose}
              className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
