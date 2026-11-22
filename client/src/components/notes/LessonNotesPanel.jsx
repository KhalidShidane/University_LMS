import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { LoaderCircle, NotebookPen, PanelRightClose, Plus, Search, TriangleAlert } from 'lucide-react'
import { apiErrorMessage } from '../../services/api.js'
import NoteList from './NoteList.jsx'
import NoteDetail from './NoteDetail.jsx'
import { notesApi } from './noteUtils.js'
import './notes.css'

const scopes = [
  { value: 'lesson', label: 'This lesson' },
  { value: 'course', label: 'This course' },
  { value: 'general', label: 'General' },
  { value: 'all', label: 'All notes' },
]

/**
 * Notes panel shown beside the lesson reader. Uses the same notes API as the My Notes page.
 */
export default function LessonNotesPanel({ lesson, course, userId, initialNoteId, expanded, onToggleExpand, onClose }) {
  const [scope, setScope] = useState('lesson')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState('custom')
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(initialNoteId || null)
  const [creating, setCreating] = useState(false)
  const requestRef = useRef(0)

  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  useEffect(() => { if (initialNoteId) setSelectedId(initialNoteId) }, [initialNoteId])

  const params = useCallback(() => {
    const result = { sort }
    if (debouncedSearch) result.search = debouncedSearch
    if (scope === 'lesson') result.lesson = lesson._id
    if (scope === 'course') { if (course?._id) result.course = course._id; else result.lesson = lesson._id }
    if (scope === 'general') result.course = 'none'
    return result
  }, [scope, sort, debouncedSearch, lesson._id, course?._id])

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true); setError('')
    try {
      const data = await notesApi.list(params())
      if (requestId === requestRef.current) setNotes(data.notes)
    } catch (requestError) {
      if (requestId === requestRef.current) setError(apiErrorMessage(requestError))
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [params])
  useEffect(() => { load() }, [load])

  async function createNote() {
    setCreating(true)
    try {
      const body = scope === 'general' ? {} : scope === 'course' && course?._id ? { course: course._id } : { lesson: lesson._id }
      const note = await notesApi.create(body)
      setNotes((current) => [note, ...current])
      setSelectedId(note._id)
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) } finally { setCreating(false) }
  }

  async function reorder(nextNotes) {
    const previous = notes
    setNotes(nextNotes)
    try { await notesApi.reorder(nextNotes.map((note) => note._id)) } catch (requestError) { setNotes(previous); toast.error(apiErrorMessage(requestError)) }
  }

  const onSaved = useCallback((saved) => {
    setNotes((current) => current.map((note) => note._id === saved._id ? { ...note, ...saved, excerpt: saved.excerpt } : note))
  }, [])

  function onDeleted(id) {
    setNotes((current) => current.filter((note) => note._id !== id))
    setSelectedId(null)
  }

  const reorderable = sort === 'custom' && !debouncedSearch && notes.length > 1

  return <aside className="notes-panel" id="lesson-notes-panel" aria-label="My notes">
    {selectedId ? <NoteDetail
      key={selectedId}
      noteId={selectedId}
      userId={userId}
      onBack={() => { setSelectedId(null); load() }}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onClose={onClose}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    /> : <div className="notes-panel-list">
      <div className="notes-panel-header">
        <h2><NotebookPen size={16} /> My notes</h2>
        <span className="note-detail-actions">
          <button type="button" className="button-primary notes-new-button" onClick={createNote} disabled={creating}>{creating ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} New note</button>
          {onClose && <button type="button" className="note-icon-button" onClick={onClose} aria-label="Close notes" title="Close notes"><PanelRightClose size={16} /></button>}
        </span>
      </div>
      <div className="notes-scope" role="tablist" aria-label="Which notes to show">
        {scopes.map((item) => <button key={item.value} type="button" role="tab" aria-selected={scope === item.value} className={scope === item.value ? 'is-active' : ''} onClick={() => setScope(item.value)}>{item.label}</button>)}
      </div>
      <div className="notes-filter-row">
        <label className="notes-search"><Search size={14} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort notes">
          <option value="custom">My order</option>
          <option value="updated">Last updated</option>
          <option value="created">Date created</option>
        </select>
      </div>
      <div className="notes-scroll notes-panel-scroll">
        {error ? <div className="notes-state is-error" role="alert"><TriangleAlert size={18} /><p>{error}</p><button type="button" className="button-secondary" onClick={load}>Try again</button></div>
          : loading && !notes.length ? <div className="notes-state" role="status"><LoaderCircle size={18} className="spin" /><p>Loading notes…</p></div>
            : notes.length ? <>
              <NoteList notes={notes} selectedId={selectedId} onSelect={(note) => setSelectedId(note._id)} reorderable={reorderable} onReorder={reorder} showContext={scope !== 'lesson'} />
              {sort === 'custom' && debouncedSearch && <p className="notes-hint">Clear the search to drag notes into a new order.</p>}
            </>
              : <div className="notes-state"><NotebookPen size={20} /><p>{debouncedSearch ? 'No notes match your search.' : scope === 'lesson' ? 'No notes for this lesson yet. Start one while you read.' : 'No notes here yet.'}</p>{!debouncedSearch && <button type="button" className="button-secondary" onClick={createNote} disabled={creating}><Plus size={14} /> New note</button>}</div>}
      </div>
      <div className="notes-panel-footer"><Link to="/app/notes">Open all notes</Link></div>
    </div>}
  </aside>
}
