import { useState, useEffect, useCallback } from 'react'
import Header from './components/Header'
import SubjectFilter from './components/SubjectFilter'
import BookGrid from './components/BookGrid'
import UpdateIndexModal from './components/UpdateIndexModal'
import SettingsModal from './components/SettingsModal'
import { useBooks } from './hooks/useBooks'
import { api } from './api/client'
import type { Subject } from './types'

export default function App() {
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

  // Load subject list on mount
  useEffect(() => {
    api.subjects.list().then(setSubjects).catch(console.error)
  }, [])

  const { books, total, stats, isLoading, updateBook, refetch } = useBooks({
    q: debouncedQuery,
    subject: selectedSubject,
  })

  const handleIndexComplete = useCallback(() => {
    refetch()
    api.subjects.list().then(setSubjects).catch(console.error)
  }, [refetch])

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onUpdateIndex={() => setShowUpdateModal(true)}
        onSettings={() => setShowSettings(true)}
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
      />

      {showUpdateModal && (
        <UpdateIndexModal
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
