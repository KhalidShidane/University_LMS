import { useEffect, useMemo, useState } from 'react'
import AddLessonMaterials from '../../components/common/AddLessonMaterials.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, BookOpenCheck, FilePlus2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './TeacherLessonsPage.css'

const blankForm = (courseId = '', classId = '') => ({ title: '', course: courseId, class: classId, status: 'draft', resourceLinks: [] })
const dateLabel = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))

export default function TeacherLessonsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const courseFilter = searchParams.get('courseId') || ''
  const classFilter = searchParams.get('classId') || ''
  const [lessons, setLessons] = useState([])
  const [courses, setCourses] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [lastSelectedCourse, setLastSelectedCourse] = useState('')
  const [lastSelectedClass, setLastSelectedClass] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [materials, setMaterials] = useState([])
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [materialTarget, setMaterialTarget] = useState(null)

  async function load({ openFromUrl = false, silent = false } = {}) {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [lessonsResult, coursesResult] = await Promise.all([api.get('/lessons/teacher', { params: searchParams.get('classId') ? { class: searchParams.get('classId') } : {} }), api.get('/teacher/courses')])
      const availableCourses = coursesResult.data.courses || []
      setLessons(lessonsResult.data.lessons); setCourses(availableCourses)
      const requestedCourse = availableCourses.find((item) => item._id === searchParams.get('courseId') && (!searchParams.get('classId') || String(item.assignmentClassId) === searchParams.get('classId')))
      if (openFromUrl && requestedCourse && searchParams.get('create') === '1') {
        setLastSelectedCourse(requestedCourse._id)
        setLastSelectedClass(requestedCourse.assignmentClassId || searchParams.get('classId') || '')
        setEditing(null); setForm({ ...blankForm(requestedCourse._id, requestedCourse.assignmentClassId || searchParams.get('classId') || ''), status: searchParams.get('status') === 'published' ? 'published' : 'draft' }); setMaterials([]); setShowEditor(true)
      }
      if (openFromUrl && searchParams.has('create')) {
        // Open the create form only once; later reloads (archive, delete, create) must not reopen it.
        const next = new URLSearchParams(searchParams)
        next.delete('create'); next.delete('status')
        setSearchParams(next, { replace: true })
      }
    } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load({ openFromUrl: true }) }, [])

  const filtered = useMemo(() => lessons.filter((item) => (!courseFilter || String(item.course?._id || item.course || '') === courseFilter) && (statusFilter === 'all' || item.status === statusFilter) && `${item.title} ${item.subject} ${item.summary} ${item.course?.name} ${item.class?.name}`.toLowerCase().includes(search.toLowerCase())), [lessons, search, statusFilter, courseFilter])
  function beginCreate() { const course = courses.find((item) => courseFilter && item._id === courseFilter && (!classFilter || String(item.assignmentClassId) === classFilter)) || courses.find((item) => item._id === lastSelectedCourse && (!lastSelectedClass || item.assignmentClassId === lastSelectedClass)) || courses.find((item) => !searchParams.get('classId') || item.assignmentClassId === searchParams.get('classId')) || courses[0]; setEditing(null); setForm(blankForm(course?._id || '', course?.assignmentClassId || '')); setMaterials([]); setShowEditor(true) }
  async function beginEdit(item) {
    try {
      const { data } = await api.get(`/lessons/teacher/${item._id}`)
      const lesson = data.lesson
      const courseId = lesson.course?._id || lesson.course || ''
      setLastSelectedCourse(courseId)
      setLastSelectedClass(String(lesson.class?._id || lesson.class || ''))
      setEditing(lesson); setForm({ title: lesson.title, subject: lesson.subject || '', summary: lesson.summary || '', content: lesson.content, course: courseId, class: String(lesson.class?._id || lesson.class || ''), status: lesson.status || 'draft', resourceLinks: (lesson.attachments || []).map(({ url }) => url) }); setMaterials([])
      setShowEditor(true)
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function save(e) {
    e.preventDefault()
    const resourceUrls = form.resourceLinks.map((url) => url.trim()).filter(Boolean)
    let attachments
    try {
      attachments = resourceUrls.map((url) => {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported resource URL')
        return { name: parsed.hostname.replace(/^www\./, ''), url }
      })
    } catch { toast.error('Enter a valid HTTP or HTTPS link in each link field'); return }
    if (!editing && !materials.length && !attachments.length) { toast.error('Add a lesson link or choose at least one material file'); return }
    setSaving(true); setProgress(0)
    try {
      const { resourceLinks, ...lessonFields } = form
      const payload = { ...lessonFields, attachments }
      const saved = editing
        ? (await api.patch(`/lessons/teacher/${editing._id}`, payload)).data.lesson
        : (await api.post('/lessons/teacher', payload)).data.lesson
      setEditing(saved)
      if (materials.length) {
        const body = new FormData(); materials.forEach((file) => body.append('files', file))
        await api.post(`/lessons/teacher/${saved._id}/materials`, body, { onUploadProgress: (event) => setProgress(Math.round((event.loaded * 100) / (event.total || event.loaded))) })
      }
      toast.success(editing ? 'Lesson updated' : 'Lesson created'); closeEditor(); await load({ silent: true })
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setSaving(false); setProgress(0) }
  }
  function updateResourceLink(index, value) { setForm((current) => ({ ...current, resourceLinks: current.resourceLinks.map((url, i) => i === index ? value : url) })) }
  function addResourceLink() {
    if (form.resourceLinks.length >= 50) return toast.error('You can add up to 50 lesson links')
    setForm((current) => ({ ...current, resourceLinks: [...current.resourceLinks, ''] }))
  }
  function removeResourceLink(index) { setForm((current) => ({ ...current, resourceLinks: current.resourceLinks.filter((_, i) => i !== index) })) }
  function closeEditor() { setShowEditor(false); setEditing(null); setForm(blankForm()); setMaterials([]) }
  async function setStatus(lesson, status) {
    try { await api.patch(`/lessons/teacher/${lesson._id}/status`, { status }); toast.success(`Lesson ${status}`); closeEditor(); await load({ silent: true }) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function remove(lesson) {
    if (!window.confirm(`Delete “${lesson.title}”?`)) return
    try { await api.delete(`/lessons/teacher/${lesson._id}`); toast.success('Lesson deleted'); closeEditor(); await load({ silent: true }) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function download(lesson, material) {
    try { const { data } = await api.get(`/lessons/${lesson._id}/materials/${material._id}`, { responseType: 'blob' }); const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = material.originalName; a.click(); URL.revokeObjectURL(url) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function removeMaterial(lesson, material) {
    try { await api.delete(`/lessons/teacher/${lesson._id}/materials/${material._id}`); toast.success('Material removed'); await load({ silent: true }); if (editing?._id === lesson._id) beginEdit(lesson) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />
  return <div className="teacher-lessons-page">
    <div className="section-title-row"><div><div className="section-kicker">LEARNING CONTENT</div><h1>{courseFilter ? (courses.find((item) => item._id === courseFilter)?.name || 'Lessons') : 'Lessons'}</h1><p>Create and share learning materials inside your assigned courses.</p></div><div className="lesson-card-actions"><button className="button-secondary" onClick={() => navigate(classFilter ? `/app/classes/${classFilter}` : '/app/classes')}><ArrowLeft size={15} /> Back to courses</button><button className="button-primary" onClick={beginCreate} disabled={!courses.length}><Plus size={16} /> Add lesson</button></div></div>
    <div className="management-toolbar lesson-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search lessons" placeholder="Search lessons or courses" value={search} onChange={(e) => setSearch(e.target.value)} /></label><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select><span className="toolbar-note">{filtered.length} {filtered.length === 1 ? 'lesson' : 'lessons'}</span></div>
    {filtered.length ? <div className="lesson-management-grid">{filtered.map((lesson) => <article className="panel lesson-management-card" key={lesson._id}><div className="lesson-cover teacher-lesson-cover gradient-cover"><span className={`status-pill ${lesson.status === 'published' ? 'status-complete' : lesson.status === 'archived' ? 'status-inactive' : 'status-pending'}`}>{lesson.status}</span><BookOpenCheck size={34} strokeWidth={1.6} aria-hidden="true" /><span className="gradient-cover-label">{lesson.course?.courseCode || lesson.subject || 'Lesson'}</span></div><div className="lesson-management-body"><div className="content-card-title"><div><h2>{lesson.title}</h2><small>{lesson.subject || lesson.course?.courseCode || 'Lesson'}</small></div><button className="icon-button" title="Edit lesson" onClick={() => beginEdit(lesson)}><Pencil size={16} /></button></div><p>{lesson.summary || lesson.content?.slice(0, 130) || 'No summary added.'}</p><div className="content-card-meta"><span>{lesson.course?.name || 'Legacy class lesson'}</span><span>Updated {dateLabel(lesson.updatedAt)}</span></div>{lesson.materials?.length > 0 && <div className="lesson-material-list">{lesson.materials.map((material) => <div className="lesson-material" key={material._id}><FilePlus2 size={15} /><span title={material.originalName}>{material.originalName}</span><button className="icon-button" onClick={() => download(lesson, material)} aria-label={`Download ${material.originalName}`}><ArrowDownToLine size={15} /></button>{lesson.status !== 'published' && <button className="icon-button" onClick={() => removeMaterial(lesson, material)} aria-label={`Remove ${material.originalName}`}><X size={15} /></button>}</div>)}</div>}<div className="lesson-card-actions"><button className="button-secondary lesson-add-materials" onClick={() => setMaterialTarget(lesson)}><FilePlus2 size={15} /> Add materials</button>{lesson.status === 'published' ? <button className="button-secondary" onClick={() => setStatus(lesson, 'draft')}>Move to draft</button> : <button className="button-primary" onClick={() => setStatus(lesson, 'published')}>Publish</button>}{lesson.status !== 'archived' && <button className="button-quiet" onClick={() => setStatus(lesson, 'archived')}>Archive</button>}<button className="button-quiet danger-icon" onClick={() => remove(lesson)} aria-label="Delete lesson"><Trash2 size={16} /> Delete</button></div></div></article>)}</div> : <EmptyState title={search || statusFilter !== 'all' ? 'No matching lessons' : 'No lessons created'} description={search || statusFilter !== 'all' ? 'Try another search or status filter.' : courses.length ? 'Create a lesson inside one of your assigned courses.' : 'No courses are assigned to your account yet. Ask an administrator to assign a course.'} icon={BookOpenCheck} />}
    {showEditor && <div className="modal-backdrop" role="presentation"><section className="lesson-editor panel" role="dialog" aria-modal="true" aria-labelledby="lesson-editor-title"><div className="panel-heading"><div><div className="section-kicker">LESSON CONTENT</div><h2 id="lesson-editor-title">{editing ? 'Edit lesson' : 'Create a lesson'}</h2><p>{editing ? 'Update this lesson and its learning materials.' : `Creating a lesson for ${courses.find((item) => item._id === form.course)?.name || 'your selected course'}.`}</p></div><button className="icon-button" onClick={() => setShowEditor(false)} aria-label="Close"><X size={18} /></button></div><form className="lesson-form" id="lesson-editor-form" onSubmit={save}><label>Lesson title<input required maxLength="160" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><div className="option-grid"><label>Initial status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="published">Published</option></select></label><label>Materials<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => setMaterials(Array.from(e.target.files || []))} /><small>PDF, Office files, or images · 10 MB per file, up to 8 at once</small></label></div>{editing?.materials?.length > 0 && <div className="lesson-material-list"><strong>Current materials</strong>{editing.materials.map((material) => <div className="lesson-material" key={material._id}><FilePlus2 size={15} /><span>{material.originalName}</span><button className="icon-button" type="button" onClick={() => removeMaterial(editing, material)} aria-label={`Remove ${material.originalName}`}><X size={15} /></button></div>)}</div>}{materials.length > 0 && <p className="inline-empty">{materials.length} file(s) selected</p>}{saving && progress > 0 && <div className="lesson-progress" role="status">Uploading materials: {progress}%<progress value={progress} max="100" /></div>}<div className="form-actions"><button className="button-secondary" type="button" onClick={() => setShowEditor(false)}>Cancel</button><button className="button-primary" disabled={saving || !courses.length}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create lesson'}<Upload size={15} /></button></div></form><section className="lesson-links-editor"><div className="lesson-links-heading"><div><h3>Lesson links</h3><small>Add as many resource URLs as you need.</small></div><button className="button-secondary add-lesson-link" type="button" onClick={addResourceLink} disabled={form.resourceLinks.length >= 50}><Plus size={13} /> Add link</button></div>{form.resourceLinks.map((url, index) => <div className="lesson-resource-row" key={index}><label className="lesson-resource-input"><span>Resource link {index + 1}</span><input form="lesson-editor-form" type="url" value={url} maxLength={2000} placeholder="https://example.com/resource" onChange={(event) => updateResourceLink(index, event.target.value)} /></label><button className="icon-button danger-icon" type="button" onClick={() => removeResourceLink(index)} aria-label={`Remove resource link ${index + 1}`}><X size={15} /></button></div>)}</section></section></div>}
    {materialTarget && <AddLessonMaterials lesson={materialTarget} onClose={() => setMaterialTarget(null)} onUploaded={() => load({ silent: true })} />}
  </div>
}
