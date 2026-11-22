import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { LoaderCircle, NotebookPen, Plus, Search, TriangleAlert } from 'lucide-react'
import { apiErrorMessage } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import NoteList from '../../components/notes/NoteList.jsx'
import NoteDetail from '../../components/notes/NoteDetail.jsx'
import { notesApi } from '../../components/notes/noteUtils.js'
import '../../components/notes/notes.css'

export default function StudentNotesPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [facets, setFacets] = useState({ courses: [], lessons: [], tags: [], total: 0 })
  const [notes, setNotes] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [course, setCourse] = useState('')
  const [lesson, setLesson] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('custom')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const selectedId = searchParams.get('note')
  const requestRef = useRef(0)

  const select = useCallback((id) => {
    setSearchParams((current) => { const next = new URLSearchParams(current); if (id) next.set('note', id); else next.delete('note'); next.delete('new'); return next }, { replace: !id })
  }, [setSearchParams])

  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer) }, [search])

  const loadFacets = useCallback(() => notesApi.facets().then(setFacets).catch(() => {}), [])
  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true); setError('')
    try {
      const params = { sort }
      if (debouncedSearch) params.search = debouncedSearch
      if (course) params.course = course
      if (lesson) params.lesson = lesson
      if (tag) params.tag = tag
      const data = await notesApi.list(params)
      if (requestId !== requestRef.current) return
      setNotes(data.notes); setTotal(data.total)
    } catch (requestError) {
      if (requestId === requestRef.current) setError(apiErrorMessage(requestError))
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [sort, debouncedSearch, course, lesson, tag])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadFacets() }, [loadFacets])

  async function createNote() {
    setCreating(true)
    try {
      const body = lesson ? { lesson } : course && course !== 'none' ? { course } : {}
      const note = await notesApi.create(body)
      setNotes((current) => [note, ...current]); setTotal((value) => value + 1)
      select(note._id)
      loadFacets()
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) } finally { setCreating(false) }
  }

  // Dashboard "New note" shortcut: /app/notes?new=1
  const handledNew = useRef(false)
  useEffect(() => { if (searchParams.get('new') === '1' && !handledNew.current) { handledNew.current = true; createNote() } }, [searchParams])

  async function reorder(nextNotes) {
    const previous = notes
    setNotes(nextNotes)
    try { await notesApi.reorder(nextNotes.map((note) => note._id)) } catch (requestError) { setNotes(previous); toast.error(apiErrorMessage(requestError)) }
  }

  const onSaved = useCallback((saved) => {
    setNotes((current) => current.map((note) => note._id === saved._id ? { ...note, ...saved } : note))
    if (saved.course?._id || saved.lesson?._id) loadFacets()
  }, [loadFacets])

  function onDeleted(id) {
    setNotes((current) => current.filter((note) => note._id !== id)); setTotal((value) => Math.max(0, value - 1))
    select(null); loadFacets()
  }

  const lessonOptions = useMemo(() => facets.lessons.filter((item) => !course || course === 'none' ? false : String(item.course) === course), [facets.lessons, course])
  const filtersActive = Boolean(debouncedSearch || course || lesson || tag)
  const reorderable = sort === 'custom' && !filtersActive && notes.length > 1

  return <div className={`notes-page ${selectedId ? 'has-selection' : ''} ${expanded ? 'is-expanded' : ''}`}>
    <div className="section-title-row"><div><div className="section-kicker">STUDY NOTES</div><h1>My notes</h1><p>Your personal notes from every course and lesson, in one place.</p></div><button type="button" className="button-primary" onClick={createNote} disabled={creating}>{creating ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} New note</button></div>
    <div className="notes-page-layout">
      <section className="notes-page-list" aria-label="Notes list">
        <div className="notes-page-filters">
          <label className="notes-search"><Search size={14} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, content and tags" aria-label="Search notes" /></label>
          <div className="notes-filter-grid">
            <select value={course} onChange={(event) => { setCourse(event.target.value); setLesson('') }} aria-label="Filter by course">
              <option value="">All courses</option>
              <option value="none">General notes</option>
              {facets.courses.map((item) => <option key={item._id} value={item._id}>{item.courseCode ? `${item.courseCode} · ` : ''}{item.name} ({item.count})</option>)}
            </select>
            <select value={lesson} onChange={(event) => setLesson(event.target.value)} aria-label="Filter by lesson" disabled={!lessonOptions.length}>
              <option value="">{course && course !== 'none' ? 'All lessons' : 'Choose a course first'}</option>
              {lessonOptions.map((item) => <option key={item._id} value={item._id}>{item.title} ({item.count})</option>)}
            </select>
            {facets.tags.length > 0 && <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {facets.tags.map((item) => <option key={item.tag} value={item.tag}>#{item.tag} ({item.count})</option>)}
            </select>}
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort notes">
              <option value="custom">My order</option>
              <option value="updated">Last updated</option>
              <option value="created">Date created</option>
            </select>
          </div>
          <p className="notes-count">{loading ? 'Loading…' : `${total} ${total === 1 ? 'note' : 'notes'}${filtersActive ? ' match' : ''}`}{sort === 'custom' && filtersActive && notes.length > 1 ? ' · clear filters to reorder' : ''}</p>
        </div>
        <div className="notes-scroll notes-page-scroll">
          {error ? <div className="notes-state is-error" role="alert"><TriangleAlert size={18} /><p>{error}</p><button type="button" className="button-secondary" onClick={load}>Try again</button></div>
            : loading && !notes.length ? <div className="notes-state" role="status"><LoaderCircle size={18} className="spin" /><p>Loading notes…</p></div>
              : notes.length ? <NoteList notes={notes} selectedId={selectedId} onSelect={(note) => select(note._id)} reorderable={reorderable} onReorder={reorder} />
                : <div className="notes-state"><NotebookPen size={22} /><p>{filtersActive ? 'No notes match these filters.' : 'You have no notes yet. Create one here, or open a lesson and take notes while you read.'}</p>{!filtersActive && <button type="button" className="button-secondary" onClick={createNote} disabled={creating}><Plus size={14} /> New note</button>}</div>}
        </div>
      </section>
      <section className="notes-page-editor" aria-label="Note editor">
        {selectedId ? <NoteDetail key={selectedId} noteId={selectedId} userId={user.id} onBack={() => select(null)} onSaved={onSaved} onDeleted={onDeleted} expanded={expanded} onToggleExpand={() => setExpanded((value) => !value)} showLessonLink detailsOpenByDefault />
          : <div className="notes-state notes-empty-editor"><NotebookPen size={24} /><p>Select a note to read or edit it.</p></div>}
      </section>
    </div>
  </div>
}
