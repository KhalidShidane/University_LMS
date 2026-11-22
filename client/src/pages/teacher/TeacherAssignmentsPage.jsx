import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowRight, CalendarClock, CheckSquare2, FilePlus2, Plus, School, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'

const localDateInput = (date = new Date(Date.now() + 7 * 86400000)) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
const dateTime = (value) => new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))
const initialForm = (classId = '') => ({ title: '', description: '', instructions: '', classId, totalMarks: 100, dueDate: localDateInput(), status: 'draft' })

export default function TeacherAssignmentsPage() {
  const [assignments, setAssignments] = useState([]); const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [classFilter, setClassFilter] = useState('all'); const [deadline, setDeadline] = useState('all')
  const [page, setPage] = useState(1); const [pagination, setPagination] = useState(null)
  const [showEditor, setShowEditor] = useState(false); const [editing, setEditing] = useState(null); const [form, setForm] = useState(initialForm()); const [files, setFiles] = useState([]); const [saving, setSaving] = useState(false); const [progress, setProgress] = useState(0)
  async function load() {
    setLoading(true); setError('')
    try {
      const params = { page, limit: 25, ...(search ? { search } : {}), ...(status !== 'all' ? { status } : {}), ...(classFilter !== 'all' ? { class: classFilter } : {}), ...(deadline !== 'all' ? { deadline } : {}) }
      const [assignmentResult, classResult] = await Promise.all([api.get('/teacher/assignments', { params }), api.get('/teacher/classes')]); setAssignments(assignmentResult.data.assignments); setPagination(assignmentResult.data.pagination); setClasses(classResult.data.classes)
    }
    catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [page, search, status, classFilter, deadline])
  function create() { setEditing(null); setForm(initialForm(classes[0]?._id || '')); setFiles([]); setShowEditor(true) }
  async function edit(assignment) {
    try { const { data } = await api.get(`/teacher/assignments/${assignment._id}`); const item = data.assignment; setEditing(item); setForm({ title: item.title, description: item.description || '', instructions: item.instructions || '', classId: item.class?._id || item.class, totalMarks: item.totalMarks ?? item.maxScore, dueDate: localDateInput(new Date(item.dueDate)), status: item.status }); setFiles([]); setShowEditor(true) }
    catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function save(event) {
    event.preventDefault(); setSaving(true); setProgress(0)
    try {
      const payload = { ...form, dueDate: new Date(`${form.dueDate}:00+03:00`).toISOString(), totalMarks: Number(form.totalMarks) }
      const assignment = editing ? (await api.put(`/teacher/assignments/${editing._id}`, payload)).data.assignment : (await api.post('/teacher/assignments', payload)).data.assignment
      setEditing(assignment)
      if (files.length) { const body = new FormData(); files.forEach((file) => body.append('files', file)); await api.post(`/teacher/assignments/${assignment._id}/attachments`, body, { onUploadProgress: (e) => setProgress(Math.round(e.loaded * 100 / (e.total || e.loaded))) }) }
      toast.success(editing ? 'Assignment updated' : 'Assignment created'); setShowEditor(false); setEditing(null); await load()
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setSaving(false); setProgress(0) }
  }
  async function setAssignmentStatus(item, nextStatus) {
    try { await api.patch(`/teacher/assignments/${item._id}/status`, { status: nextStatus }); toast.success(`Assignment ${nextStatus}`); await load() } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function downloadAttachment(item, attachment) {
    try { const { data } = await api.get(`/assignments/${item._id}/attachments/${attachment._id}/download`, { responseType: 'blob' }); const url = URL.createObjectURL(data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.originalName; anchor.click(); URL.revokeObjectURL(url) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />
  return <>
    <div className="section-title-row"><div><div className="section-kicker">COURSEWORK</div><h1>Assignments</h1><p>Create assignments, follow submissions, and return grades to your classes.</p></div><button className="button-primary" onClick={create} disabled={!classes.length}><Plus size={16} /> Create assignment</button></div>
    <div className="assignment-filters"><label className="search-field"><Search size={15} /><input aria-label="Search assignments" placeholder="Search assignments" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} /></label><select aria-label="Filter by class" value={classFilter} onChange={(e) => { setPage(1); setClassFilter(e.target.value) }}><option value="all">All classes</option>{classes.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select><select aria-label="Filter by deadline" value={deadline} onChange={(e) => { setPage(1); setDeadline(e.target.value) }}><option value="all">All deadlines</option><option value="upcoming">Upcoming</option><option value="due">Due within 24 hours</option><option value="overdue">Overdue</option></select></div>
    {assignments.length ? <div className="assignment-card-grid">{assignments.map((item) => <article className="panel teacher-assignment-card" key={item._id}><div className="assignment-card-heading"><span className="content-card-icon assignment-color"><CheckSquare2 size={19} /></span><span className={`status-pill ${item.deadlineState === 'overdue' ? 'status-late' : item.deadlineState === 'due' ? 'status-pending' : item.status === 'published' ? 'status-complete' : item.status === 'closed' ? 'status-inactive' : 'status-pending'}`}>{item.status === 'closed' ? 'Closed' : item.status === 'draft' ? 'Draft' : item.deadlineState === 'overdue' ? 'Overdue' : item.deadlineState === 'due' ? 'Due soon' : 'Published'}</span><button className="button-quiet" onClick={() => edit(item)}>Edit</button></div><h2>{item.title}</h2><p>{item.description || item.instructions || 'No additional description.'}</p><div className="assignment-facts"><span><SchoolIcon />{item.class?.classCode} · {item.class?.name}</span><span><CalendarClock size={14} />{dateTime(item.dueDate)}</span><span>{item.totalMarks ?? item.maxScore} total marks</span><span>{item.submittedCount || 0} submitted · {item.gradedCount || 0} graded</span></div>{item.attachments?.length > 0 && <div className="assignment-attachment-list">{item.attachments.map((attachment) => <button key={attachment._id} onClick={() => downloadAttachment(item, attachment)}><FilePlus2 size={14} /><span>{attachment.originalName}</span><ArrowDownToLine size={14} /></button>)}</div>}<div className="assignment-card-actions"><Link className="button-primary" to={`/app/assignments/${item._id}`}>View submissions <ArrowRight size={15} /></Link>{item.status === 'draft' ? <button className="button-secondary" onClick={() => setAssignmentStatus(item, 'published')}>Publish</button> : item.status === 'published' ? <button className="button-secondary" onClick={() => setAssignmentStatus(item, 'closed')}>Close assignment</button> : <button className="button-secondary" onClick={() => setAssignmentStatus(item, 'published')}>Reopen</button>}</div></article>)}</div> : <EmptyState title={pagination?.total ? 'No matching assignments' : 'No assignments yet'} description={pagination?.total ? 'Change your search or filters.' : 'Create an assignment for one of your assigned classes.'} icon={CheckSquare2} />}
    {pagination?.pages > 1 && <div className="admin-pagination"><span>Page {pagination.page} of {pagination.pages} · {pagination.total} assignments</span><div><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button><button className="button-secondary" disabled={page >= pagination.pages} onClick={() => setPage((n) => n + 1)}>Next</button></div></div>}
    {showEditor && <div className="modal-backdrop" role="presentation"><section className="panel assignment-editor" role="dialog" aria-modal="true" aria-labelledby="assignment-form-title"><div className="panel-heading"><div><span className="section-kicker">ASSIGNMENT SETUP</span><h2 id="assignment-form-title">{editing ? 'Edit assignment' : 'Create assignment'}</h2><p>Students can access the assignment after you publish it.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowEditor(false)}><X size={18} /></button></div><form className="assignment-form" onSubmit={save}><label>Assignment title<input required maxLength="160" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><div className="assignment-form-grid"><label>Class<select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>{classes.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></label><label>Total marks<input type="number" required min="1" max="10000" value={form.totalMarks} onChange={(e) => setForm({ ...form, totalMarks: e.target.value })} /></label><label>Due date and time<input type="datetime-local" required value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /><small>Shown to users in East Africa Time (EAT).</small></label><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="published">Published now</option><option value="closed">Closed</option></select></label></div><label>Description<textarea rows="3" maxLength="5000" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><label>Instructions<textarea rows="4" maxLength="10000" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label><label className="assignment-file-picker">Attachments<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => setFiles(Array.from(e.target.files || []))} /><small>Up to 5 PDF, Office, or image files. Maximum 15 MB each.</small></label>{files.length > 0 && <p className="inline-empty">{files.length} file(s) selected</p>}{editing?.attachments?.length > 0 && <div className="assignment-attachment-list"><b>Attached files</b>{editing.attachments.map((item) => <span key={item._id}><FilePlus2 size={14} />{item.originalName}</span>)}</div>}{saving && progress > 0 && <div className="lesson-progress">Uploading files {progress}%<progress max="100" value={progress} /></div>}<div className="form-actions"><button className="button-secondary" type="button" onClick={() => setShowEditor(false)}>Cancel</button><button className="button-primary" disabled={saving || !classes.length}>{saving ? 'Saving…' : editing ? 'Save assignment' : 'Create assignment'}</button></div></form></section></div>}
  </>
}

function SchoolIcon() { return <School size={14} /> }
