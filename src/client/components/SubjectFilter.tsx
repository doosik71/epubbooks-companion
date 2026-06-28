import type { Subject } from '../types'

interface SubjectFilterProps {
  subjects: Subject[]
  selected: string
  onSelect: (slug: string) => void
}

export default function SubjectFilter({ subjects, selected, onSelect }: SubjectFilterProps) {
  return (
    <div className="bg-white border-b border-gray-200 shrink-0">
      <div className="max-w-screen-2xl mx-auto px-4 pt-2 pb-2.5 flex flex-wrap gap-1.5 overflow-y-auto max-h-[96px]">
        <button
          onClick={() => onSelect('')}
          className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            selected === ''
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {subjects.map((s) => (
          <button
            key={s.slug}
            onClick={() => onSelect(s.slug)}
            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
              selected === s.slug
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {s.name} ({s.book_count.toLocaleString()})
          </button>
        ))}
      </div>
    </div>
  )
}
