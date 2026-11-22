import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, NotebookPen, Plus } from 'lucide-react'
import { apiErrorMessage } from '../../services/api.js'
import { noteContextLabel, notesApi, noteTitle, relativeTime } from './noteUtils.js'
import './notes.css'

// Lightweight "My notes" section for the student dashboard (does not load the editor).
export default function DashboardNotesWidget() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => { notesApi.list({ sort: 'updated', limit: 5 }).then(setData).catch((requestError) => setError(apiErrorMessage(requestError))) }, [])
  return <section className="panel dashboard-notes-panel">
    <div className="panel-heading"><div><h2>My notes</h2><p>{data ? `${data.total} ${data.total === 1 ? 'note' : 'notes'} · recently edited` : 'Your personal study notes'}</p></div><span className="lesson-card-actions"><button type="button" className="button-secondary" onClick={() => navigate('/app/notes?new=1')}><Plus size={14} /> New note</button><button type="button" className="link-button" onClick={() => navigate('/app/notes')}>All notes <ArrowRight size={14} /></button></span></div>
    {error ? <p className="inline-error" role="alert">{error}</p>
      : !data ? <p className="notes-count" role="status">Loading notes…</p>
        : data.notes.length ? <div className="dashboard-notes-list">{data.notes.map((note) => <Link key={note._id} className={`note-color-${note.color || 'default'}`} to={`/app/notes?note=${note._id}`}><b>{noteTitle(note)}</b><small>{noteContextLabel(note)} · edited {relativeTime(note.updatedAt)}</small></Link>)}</div>
          : <div className="notes-state"><NotebookPen size={20} /><p>No notes yet. Open a lesson and select <b>Notes</b> to write while you read.</p></div>}
  </section>
}
