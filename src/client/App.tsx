import { useState, useEffect, useCallback } from 'react'
import Header from './components/Header'
import SubjectFilter from './components/SubjectFilter'
import BookGrid from './components/BookGrid'
import UpdateIndexModal from './components/UpdateIndexModal'
import SettingsModal from './components/SettingsModal'
import { useBooks } from './hooks/useBooks'
import { api } from './api/client'
import type { Subject, Source } from './types'

export default function App() {
  const [source, setSource] = useState<Source>('epubbooks')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Debounce search input 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Reload subjects when source changes; reset selected subject
  useEffect(() => {
    setSelectedSubject('')
    api.subjects.list(source).then(setSubjects).catch(console.error)
  }, [source])

  const { books, total, stats, isLoading, updateBook, deleteBook, refetch } = useBooks({
    q: debouncedQuery,
    subject: selectedSubject,
    source,
  })

  const handleSourceChange = useCallback((newSource: Source) => {
    setSource(newSource)
    setSearchQuery('')
    setDebouncedQuery('')
  }, [])

  const handleIndexComplete = useCallback(() => {
    refetch()
    api.subjects.list(source).then(setSubjects).catch(console.error)
  }, [refetch, source])

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onUpdateIndex={() => setShowUpdateModal(true)}
        onSettings={() => setShowSettings(true)}
        source={source}
        onSourceChange={handleSourceChange}
      />
      <SubjectFilter
        subjects={subjects}
        selected={selectedSubject}
        onSelect={setSelectedSubject}
      />
      <BookGrid
        books={books}
        total={total}
        stats={stats}
        isLoading={isLoading}
        onBookDownloaded={updateBook}
        onBookDeleted={deleteBook}
      />

      {showUpdateModal && (
        <UpdateIndexModal
          source={source}
          onClose={() => setShowUpdateModal(false)}
          onComplete={handleIndexComplete}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
