import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, Plus, Trash2, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './AdminCoursesPage.css'

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', courseCode: '' })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')

  async function load() {
    setLoading(true); setError('')
    try { const { data } = await api.get('/admin/courses'); setCourses(data.courses || []) }
    catch (requestError) { setError(apiErrorMessage(requestError)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const ordered = useMemo(() => [...courses].sort((a, b) => {
    const aGroup = `${a.department?.name || 'Unassigned'}\u0000${a.class?.classCode || 'Unassigned'}\u0000${a.name}`
    const bGroup = `${b.department?.name || 'Unassigned'}\u0000${b.class?.classCode || 'Unassigned'}\u0000${b.name}`
    return aGroup.localeCompare(bGroup)
  }), [courses])
  const grouped = useMemo(() => {
    const result = []
    for (const course of ordered) {
      const awaitingPlacement = !course.department || !course.class
      const department = awaitingPlacement ? 'Awaiting teacher and class assignment' : course.department.name
      const className = awaitingPlacement ? '' : `${course.class.classCode || ''} ${course.class.name || ''}`.trim()
      const key = `${course.department?._id || 'none'}:${course.class?._id || 'none'}`
      const last = result.at(-1)
      if (last?.key !== key) result.push({ key, department, className, courses: [course] })
      else last.courses.push(course)
    }
    return result
  }, [ordered])
  const activeCount = courses.filter((course) => course.isActive).length

  async function createCourse(event) {
    event.preventDefault(); setSaving(true)
    try {
      const payload = new FormData(); payload.append('name', form.name); payload.append('courseCode', form.courseCode)
      await api.post('/admin/courses', payload)
      setForm({ name: '', courseCode: '' }); setFormOpen(false)
      toast.success('Course created. Assign it to a teacher from the Teachers section.')
      await load()
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  async function setCourseStatus(course) {
    const isActive = !course.isActive
    if (!isActive && !window.confirm(`Deactivate ${course.name}? Its lessons will no longer be available to students or teachers until you reactivate it.`)) return
    try {
      setBusyId(String(course._id))
      const { data } = await api.patch(`/admin/courses/${course._id}/status`, { isActive })
      setCourses((current) => current.map((item) => String(item._id) === String(course._id) ? data.course : item))
      toast.success(isActive ? 'Course activated' : 'Course deactivated')
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setBusyId('') }
  }

  async function deleteCourse(course) {
    const lessonCount = course.lessonCount || 0
    const contentWarning = lessonCount ? ` This permanently removes ${lessonCount} course lesson(s) and all files uploaded to them.` : ' Any course materials will also be permanently removed.'
    if (!window.confirm(`Permanently delete ${course.name} (${course.courseCode})?${contentWarning}`)) return
    try {
      setBusyId(String(course._id)); await api.delete(`/admin/courses/${course._id}`)
      setCourses((current) => current.filter((item) => String(item._id) !== String(course._id)))
      toast.success('Course and its uploaded materials permanently deleted')
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setBusyId('') }
  }

  if (loading && !courses.length) return <PageLoading />
  if (error && !courses.length) return <ErrorState message={error} onRetry={load} />

  return <div className="admin-courses-page admin-courses-compact">
    <div className="section-title-row"><div><div className="section-kicker">ACADEMIC MANAGEMENT</div><h1>Courses</h1><p>{activeCount} active course{activeCount === 1 ? '' : 's'} · {courses.length} total</p></div><button className="button-primary" onClick={() => setFormOpen((open) => !open)}><Plus size={15} /> Create course</button></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {formOpen && <section className="panel admin-course-create-panel"><div className="panel-heading"><div><h2>Create a course</h2><p>Enter the course name and code.</p></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Close course form"><X size={17} /></button></div><form className="admin-course-create-form" onSubmit={createCourse}><label>Course name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Introduction to Computing" /></label><label>Course code<input required maxLength={30} value={form.courseCode} onChange={(event) => setForm({ ...form, courseCode: event.target.value.toUpperCase() })} placeholder="e.g. CS101" /></label><div className="admin-course-create-actions"><button type="button" className="button-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Creating…' : 'Create course'}</button></div></form></section>}
    <section className="panel admin-course-table-panel"><div className="panel-heading"><div><h2>Course list</h2><p>Courses with their departments and classes.</p></div><BookOpenCheck size={18} className="panel-heading-icon" /></div>{!courses.length ? <EmptyState title="No courses yet" description="Create a course to get started." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Course</th><th>Department</th><th>Class</th><th>Teacher</th><th>Status</th><th>Lessons</th><th>Actions</th></tr></thead><tbody>{grouped.map((group) => <FragmentRows key={group.key} group={group} busyId={busyId} onStatus={setCourseStatus} onDelete={deleteCourse} />)}</tbody></table></div>}</section>
  </div>
}

function FragmentRows({ group, busyId, onStatus, onDelete }) {
  return <>
    {group.courses.map((course) => <tr key={course._id} className={!course.isActive ? 'course-inactive-row' : ''}><td><b>{course.name}</b><small>{course.courseCode}</small></td><td>{course.department?.name || '—'}</td><td>{course.teachingAssignments?.length ? [...new Set(course.teachingAssignments.map((item) => `${item.class?.classCode || ''} ${item.class?.name || ''}`.trim()).filter(Boolean))].join(', ') : course.class ? `${course.class.classCode || ''} ${course.class.name || ''}`.trim() : '—'}</td><td>{course.teachingAssignments?.length ? [...new Set(course.teachingAssignments.map((item) => item.teacher?.fullName).filter(Boolean))].join(', ') : course.teacher?.fullName || 'Unassigned'}</td><td><span className={`status-pill ${course.isActive ? 'status-complete' : 'status-inactive'}`}>{course.isActive ? 'Active' : 'Inactive'}</span></td><td>{course.lessonCount || 0}</td><td><div className="course-row-actions"><button className="button-secondary" disabled={busyId === String(course._id)} onClick={() => onStatus(course)}>{busyId === String(course._id) ? 'Saving…' : course.isActive ? 'Deactivate' : 'Activate'}</button><button className="icon-button danger-icon" disabled={busyId === String(course._id)} onClick={() => onDelete(course)} aria-label={`Permanently delete ${course.name}`} title="Permanently delete"><Trash2 size={15} /></button></div></td></tr>)}
  </>
}
