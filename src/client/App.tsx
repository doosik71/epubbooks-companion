import { useState } from 'react'

function App() {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900 shrink-0">epubbooks companion</h1>
          <div className="flex-1 max-w-xl">
            <input
              type="search"
              placeholder="Search books by title or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors">
              Update Index
            </button>
            <button className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              ⚙ Settings
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center justify-center h-64 text-center">
          <div>
            <p className="text-gray-400 text-4xl mb-4">📚</p>
            <p className="text-gray-600 font-medium">No books indexed yet</p>
            <p className="text-gray-400 text-sm mt-1">
              Click <strong className="text-gray-600">Update Index</strong> to fetch books from
              epubbooks.com
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
