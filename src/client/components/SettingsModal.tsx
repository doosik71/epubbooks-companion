import { useState, useEffect } from 'react'
import { api } from '../api/client'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [dataPath, setDataPath] = useState('')
  const [hideCover, setHideCover] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        setDataPath(s.data_path)
        setHideCover(s.hide_cover)
        setLastUpdate(s.last_full_update)
      })
      .catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSavedOk(false)
    try {
      await api.settings.update({ data_path: dataPath, hide_cover: hideCover })
      setSavedOk(true)
      setTimeout(onClose, 900)
    } catch (err) {
      alert('Failed to save: ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              epub Download Directory
            </label>
            <input
              type="text"
              value={dataPath}
              onChange={(e) => setDataPath(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="C:\Users\you\Books"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Files saved as:{' '}
              <code className="bg-gray-100 px-1 rounded">
                {dataPath || '<path>'}/<em>author</em>/<em>title</em>.epub
              </code>
            </p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setHideCover((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${hideCover ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${hideCover ? 'translate-x-4' : ''}`}
              />
            </div>
            <span className="text-sm font-medium text-gray-700">Hide book cover images</span>
          </label>

          {lastUpdate && (
            <p className="text-xs text-gray-400">
              Last index update:{' '}
              <span className="text-gray-600">
                {new Date(lastUpdate).toLocaleString()}
              </span>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || savedOk}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {savedOk ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
