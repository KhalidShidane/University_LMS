import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpenCheck, KeyRound, Pencil, ShieldCheck, UserRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { ErrorState, PageLoading } from '../../components/ui/States.jsx'
import ProfileAvatar from '../../components/common/ProfileAvatar.jsx'
import './AdminUserDetailsPage.css'

export default function AdminUserDetailsPage({ role }) {
  const { id } = useParams()
  const endpoint = role === 'teacher' ? 'teachers' : 'students'
  const [person, setPerson] = useState(null)
  const [courses, setCourses] = useState([])
  const [options, setOptions] = useState({ faculties: [], departments: [], classes: [] })
  const [form, setForm] = useState({ fullName: '', email: '', studentId: '', faculty: '', department: '', departments: [], class: '', assignedClasses: [] })
  const [password, setPassword] = useState('')
  const [courseToAssign, setCourseToAssign] = useState('')
  const [assignmentClass, setAssignmentClass] = useState('')
  const [assignmentDepartment, setAssignmentDepartment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingCourseRemovals, setPendingCourseRemovals] = useState([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const departments = useMemo(() => options.departments.filter((item) => String(item.faculty?._id || item.faculty) === form.faculty), [options.departments, form.faculty])
  const teacherDepartmentIds = form.departments.length ? form.departments : (form.department ? [form.department] : [])
  const classes = useMemo(() => options.classes.filter((item) => role === 'teacher'
    ? teacherDepartmentIds.includes(String(item.department?._id || item.department))
    : String(item.department?._id || item.department) === form.department), [options.classes, teacherDepartmentIds.join(','), form.department, role])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const requests = [api.get(`/${endpoint}/${id}`), api.get('/academic/options')]
      if (role === 'teacher') requests.push(api.get('/admin/courses'))
      const [personResult, optionsResult, coursesResult] = await Promise.all(requests)
      const loaded = personResult.data[role]
      setPerson(loaded)
      setOptions(optionsResult.data)
      setCourses(coursesResult?.data.courses || [])
      setForm({
        fullName: loaded.fullName || '', email: loaded.email || '', studentId: loaded.studentId || '',
        faculty: String(loaded.department?.faculty?._id || loaded.class?.department?.faculty?._id || ''),
        department: String(loaded.department?._id || loaded.class?.department?._id || ''),
        departments: (loaded.departments?.length ? loaded.departments : (loaded.department ? [loaded.department] : [])).map((item) => String(item._id || item)),
        class: String(loaded.class?._id || ''),
        assignedClasses: (loaded.assignedClasses || []).map((item) => String(item._id)),
      })
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [endpoint, id])

  const assignedCourses = courses.flatMap((course) => {
    const assignments = (course.teachingAssignments || []).filter((item) => String(item.teacher?._id || item.teacher || '') === String(person?._id || ''))
    if (assignments.length) return assignments.map((item) => ({ ...course, class: item.class, teacher: item.teacher }))
    return String(course.teacher?._id || course.teacher || '') === String(person?._id || '') ? [course] : []
  })
  const availableCourses = courses.filter((course) => course.isActive
    && !((course.teachingAssignments || []).some((item) => String(item.class?._id || item.class || '') === assignmentClass)
      || (String(course.class?._id || course.class || '') === assignmentClass && course.teacher)))
  const assignmentClasses = options.classes.filter((item) => String(item.department?._id || item.department) === assignmentDepartment)

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    const payload = role === 'teacher'
      ? { fullName: form.fullName, email: form.email }
      : { fullName: form.fullName, email: form.email, studentId: form.studentId, faculty: form.faculty, department: form.department, class: form.class }
    try {
      await api.put(`/${endpoint}/${id}`, payload)
      toast.success(`${role === 'teacher' ? 'Teacher' : 'Student'} profile updated`)
      setEditing(false)
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const savedClassIds = (person?.assignedClasses || []).map((item) => String(item._id || item)).sort().join(',')
  const classesDirty = role === 'teacher' && [...form.assignedClasses].sort().join(',') !== savedClassIds

  async function saveTeacherClasses(event) {
    event.preventDefault()
    if (role !== 'teacher') return
    if (!classesDirty) return toast('No changes to save')
    setSaving(true)
    try {
      await api.put(`/teachers/${id}`, { fullName: person.fullName, email: person.email, department: form.departments[0], departments: form.departments, assignedClasses: form.assignedClasses })
      toast.success(form.assignedClasses.length ? 'Changes saved. You can now assign courses.' : 'Changes saved. The teacher has no assigned classes.')
      setAssignmentDepartment('')
      setAssignmentClass('')
      await load()
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  async function assignCourse(event) {
    event.preventDefault()
    if (!courseToAssign) return toast.error('Choose a course')
    const classId = assignmentClass
    if (!classId) return toast.error("Choose one of the teacher's assigned classes")
    setSaving(true)
    try {
      await api.patch(`/admin/courses/${courseToAssign}/teacher`, { teacherId: person._id, classId })
      toast.success('Course assigned to teacher')
      setCourseToAssign(''); setAssignmentClass('')
      await load()
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  const courseAssignmentKey = (course) => `${course._id}:${String(course.class?._id || course.class || '')}`

  function toggleCourseRemoval(course) {
    const key = courseAssignmentKey(course)
    setPendingCourseRemovals((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  async function saveCourseRemovals() {
    const targets = assignedCourses.filter((course) => pendingCourseRemovals.includes(courseAssignmentKey(course)))
    if (!targets.length) return
    if (!window.confirm(`Remove ${targets.length} ${targets.length === 1 ? 'course' : 'courses'} from ${person.fullName}?`)) return
    setSaving(true)
    let removed = 0
    try {
      for (const course of targets) {
        const classId = String(course.class?._id || course.class || '')
        await api.patch(`/admin/courses/${course._id}/teacher`, classId ? { classId } : {})
        removed += 1
      }
      toast.success(removed === 1 ? 'Course removed from teacher' : `${removed} courses removed from teacher`)
      setPendingCourseRemovals([])
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
      setPendingCourseRemovals((current) => current.filter((key) => !targets.slice(0, removed).some((course) => courseAssignmentKey(course) === key)))
    } finally {
      await load()
      setSaving(false)
    }
  }

  async function toggleAssignedCourse(course) {
    const isActive = !course.isActive
    if (!isActive && !window.confirm(`Deactivate ${course.name} for this teacher? Students and the teacher will lose access to its course materials until it is reactivated.`)) return
    setSaving(true)
    try {
      const { data } = await api.patch(`/admin/courses/${course._id}/status`, { isActive })
      setCourses((current) => current.map((item) => String(item._id) === String(course._id) ? data.course : item))
      toast.success(isActive ? 'Course activated' : 'Course deactivated')
    } catch (requestError) { toast.error(apiErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  async function changeStatus() {
    const action = person.isActive ? 'deactivate' : 'reactivate'
    if (!window.confirm(`Are you sure you want to ${action} ${person.fullName}?`)) return
    try {
      await api.patch(`/${endpoint}/${id}/status`, { isActive: !person.isActive })
      toast.success(`Account ${person.isActive ? 'deactivated' : 'reactivated'}`)
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    }
  }

  async function resetTwoFactor() {
    if (!window.confirm('Remove two-step verification from this account? Use this only when the user lost their phone and recovery codes. They will be signed out everywhere.')) return
    try {
      const { data } = await api.post(`/users/${id}/2fa/reset`)
      toast.success(data.message)
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    }
  }

  async function resetPassword(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.patch(`/${endpoint}/${id}/password`, { password })
      setPassword('')
      toast.success(`${role === 'teacher' ? 'Teacher' : 'Student'} password reset`)
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!person) return <ErrorState message={`${role} not found`} />

  return <>
    <div className="section-title-row"><div><div className="section-kicker">UNIVERSITY ADMINISTRATION / {role.toUpperCase()} PROFILE</div><h1>{person.fullName}</h1><p>View account information and manage university access.</p></div><Link className="button-secondary" to={`/app/${endpoint}`}><ArrowLeft size={15} />Back to {endpoint}</Link></div>
    <div className="admin-user-details-grid">
      <section className="panel admin-user-profile"><div className="admin-user-profile-head"><ProfileAvatar user={person} size="large" /><div><h2>{person.fullName}</h2><span className={`role-pill role-${person.role}`}>{person.role}</span></div></div>
        <dl className="profile-details">
          <div><dt>Email</dt><dd>{person.email}</dd></div>
          {role === 'student' && <div><dt>Student ID</dt><dd>{person.studentId}</dd></div>}
          {(role === 'student' || person.assignedClasses?.length > 0) && <>
            <div><dt>Faculty</dt><dd>{role === 'teacher' ? [...new Set((person.departments || []).map((item) => item.faculty?.name).filter(Boolean))].join(', ') : person.department?.faculty?.name || person.class?.department?.faculty?.name}</dd></div>
            <div><dt>Department</dt><dd>{role === 'teacher' ? (person.departments || []).map((item) => item.name).join(', ') : person.department?.name || person.class?.department?.name}</dd></div>
          </>}
          {role === 'student' && <div><dt>Class</dt><dd>{person.class?.classCode ? `${person.class.classCode} · ${person.class.name}` : '—'}</dd></div>}
          {role === 'teacher' && person.assignedClasses?.length > 0 && <div><dt>Assigned classes ({person.assignedClasses.length})</dt><dd>{person.assignedClasses.map((item) => `${item.classCode} · ${item.name}`).join(', ')}</dd></div>}
          {role === 'teacher' && <div><dt>Assigned courses</dt><dd>{assignedCourses.length}</dd></div>}
          <div><dt>Account status</dt><dd><span className={`status-pill ${person.isActive ? 'status-complete' : 'status-inactive'}`}>{person.isActive ? 'Active' : 'Inactive'}</span></dd></div>
          <div><dt>Created</dt><dd>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(person.createdAt))}</dd></div>
        </dl>
        <div className="profile-photo-actions"><button className="button-primary" onClick={() => setEditing((value) => !value)}><Pencil size={15} />{editing ? 'Close editor' : 'Edit profile'}</button><button className="button-secondary" onClick={changeStatus}><ShieldCheck size={15} />{person.isActive ? 'Deactivate account' : 'Reactivate account'}</button></div>
      </section>
      <div className="admin-user-side-panels">{editing && <section className="panel"><div className="panel-heading"><div><h2>Edit {role} profile</h2><p>Role is managed by the system and cannot be changed here.</p></div><UserRound size={18} className="panel-heading-icon" /></div><form className="form-grid" onSubmit={save}><label className="form-grid-span">Full name<input required maxLength={160} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><label className="form-grid-span">Email<input type="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{role === 'student' && <label>Student ID<input required maxLength={40} value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} /></label>}{role === 'student' ? <><label>Faculty<select required value={form.faculty} onChange={(event) => setForm({ ...form, faculty: event.target.value, department: '', class: '' })}><option value="">Choose faculty</option>{options.faculties.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Department<select required value={form.department} disabled={!form.faculty} onChange={(event) => setForm({ ...form, department: event.target.value, class: '' })}><option value="">Choose department</option>{departments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="form-grid-span">Class<select required value={form.class} disabled={!form.department} onChange={(event) => setForm({ ...form, class: event.target.value })}><option value="">Choose class</option>{classes.map((item) => <option key={item._id} value={item._id}>{item.classCode} Â· {item.name}</option>)}</select></label></> : null}<div className="form-actions form-grid-span"><button className="button-primary" disabled={saving}>{saving ? 'Savingâ€¦' : 'Save profile'}</button></div></form></section>}
                {role === 'teacher' && <><section className="panel teacher-class-assignment-panel"><div className="panel-heading"><div><h2>Step 1 · Assign classes</h2><p>Select a department, then its class. Add more class pairs as needed.</p></div><UserRound size={18} className="panel-heading-icon" /></div><form className="form-grid" onSubmit={saveTeacherClasses}><label>Department<select value={assignmentDepartment} onChange={(event) => { setAssignmentDepartment(event.target.value); setAssignmentClass('') }}><option value="">Choose department</option>{options.departments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Class<select value={assignmentClass} disabled={!assignmentDepartment} onChange={(event) => setAssignmentClass(event.target.value)}><option value="">Choose class</option>{assignmentClasses.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></label><div className="form-actions form-grid-span"><button type="button" className="button-secondary" disabled={!assignmentDepartment || !assignmentClass} onClick={() => { const classId = assignmentClass; if (form.assignedClasses.includes(classId)) return toast.error('This class is already assigned'); setForm((current) => ({ ...current, departments: [...new Set([...current.departments, assignmentDepartment])], department: current.department || assignmentDepartment, assignedClasses: [...current.assignedClasses, classId] })); setAssignmentClass('') }}>Add class</button></div><div className="form-grid-span"><span className="field-label">Assigned classes ({form.assignedClasses.length})</span><div className="check-options">{form.assignedClasses.map((classId) => { const item = options.classes.find((record) => String(record._id) === classId); if (!item) return null; const dept = options.departments.find((record) => String(record._id) === String(item.department?._id || item.department)); return <span className="check-option" key={classId}>{dept?.name} · {item.classCode} · {item.name}<button type="button" className="icon-button danger-icon" aria-label={`Remove ${item.classCode}`} onClick={() => setForm((current) => { const assignedClasses = current.assignedClasses.filter((value) => value !== classId); const departments = [...new Set(assignedClasses.map((value) => { const found = options.classes.find((record) => String(record._id) === value); return String(found?.department?._id || found?.department || '') }).filter(Boolean))]; return { ...current, assignedClasses, departments, department: departments[0] || '' } })}>×</button></span> })}{!form.assignedClasses.length && <p className="inline-empty">No classes assigned yet.</p>}</div></div><div className="form-actions form-grid-span">{classesDirty && <span className="unsaved-changes-note" role="status">You have unsaved changes</span>}<button className="button-secondary" type="button" disabled={saving || !classesDirty} onClick={() => setForm((current) => ({ ...current, assignedClasses: (person.assignedClasses || []).map((item) => String(item._id || item)), departments: (person.departments?.length ? person.departments : (person.department ? [person.department] : [])).map((item) => String(item._id || item)) }))}>Undo</button><button className="button-primary" disabled={saving || !classesDirty}>{saving ? 'Saving…' : 'Save changes'}</button></div></form></section>
        {person.assignedClasses?.length ? <section className="panel teacher-course-assignment-panel">
          <div className="panel-heading"><div><h2>Step 2 · Assign courses</h2><p>{person.assignedClasses.length} classes · {assignedCourses.length} assigned courses</p></div><BookOpenCheck size={18} className="panel-heading-icon" /></div>
          {assignedCourses.length > 0 && <><div className="teacher-assigned-course-list">{assignedCourses.map((course) => { const pendingRemoval = pendingCourseRemovals.includes(courseAssignmentKey(course)); return <div key={courseAssignmentKey(course)} className={pendingRemoval ? 'course-pending-removal' : ''}><span><b>{course.courseCode} · {course.name}</b><small>{course.class?.classCode || 'Class'} · {course.class?.name || ''}{pendingRemoval ? ' · will be removed' : ''}</small></span><span className={`status-pill ${course.isActive ? 'status-complete' : 'status-inactive'}`}>{course.isActive ? 'Active' : 'Inactive'}</span>{!pendingRemoval && <button type="button" className="button-secondary teacher-course-status-button" disabled={saving} onClick={() => toggleAssignedCourse(course)}>{course.isActive ? 'Deactivate' : 'Activate'}</button>}<button type="button" className={`${pendingRemoval ? 'button-secondary' : 'button-quiet danger-icon'} teacher-course-status-button`} disabled={saving} onClick={() => toggleCourseRemoval(course)}>{pendingRemoval ? 'Undo' : 'Remove'}</button></div> })}</div>{pendingCourseRemovals.length > 0 && <div className="form-actions"><span className="unsaved-changes-note" role="status">You have unsaved changes</span><button type="button" className="button-secondary" disabled={saving} onClick={() => setPendingCourseRemovals([])}>Undo</button><button type="button" className="button-primary" disabled={saving} onClick={saveCourseRemovals}>{saving ? 'Saving…' : 'Save changes'}</button></div>}</>}
          <form className="form-grid teacher-assign-course-form" onSubmit={assignCourse}>
            <label>Class<select required value={assignmentClass} onChange={(event) => { setAssignmentClass(event.target.value); setCourseToAssign('') }}><option value="">Choose class first</option>{(person.assignedClasses || []).map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></label>
            <label>Course<select required value={courseToAssign} disabled={!assignmentClass} onChange={(event) => setCourseToAssign(event.target.value)}><option value="">Choose a course</option>{availableCourses.map((course) => <option key={course._id} value={course._id}>{course.courseCode} · {course.name}{course.teacher?.fullName ? ` · assigned to ${course.teacher.fullName}` : ''}</option>)}</select></label>
            {assignmentClass && !availableCourses.length && <p className="form-grid-span inline-empty">No courses available. Create a course from Courses first.</p>}
            <div className="form-actions form-grid-span"><button className="button-primary" disabled={saving || !availableCourses.length || !assignmentClass}>{saving ? 'Assigning…' : 'Assign course'}</button></div>
          </form>
        </section> : <section className="panel teacher-course-assignment-panel"><h2>Step 2 · Assign courses</h2><p className="inline-empty">Assign at least one class above to choose a course for this teacher.</p></section>}</>}
        {['teacher', 'student'].includes(role) && <section className="panel"><div className="panel-heading"><div><h2>Reset password</h2><p>Set a new password for this {role} account.</p></div><KeyRound size={18} className="panel-heading-icon" /></div><form className="form-grid" onSubmit={resetPassword}><label className="form-grid-span">New password<input required type="password" minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><div className="form-actions form-grid-span"><button className="button-secondary" disabled={saving}>{saving ? 'Resettingâ€¦' : 'Reset password'}</button></div></form></section>}<section className="panel"><div className="panel-heading"><div><h2>Two-step verification</h2><p>If this user lost their phone and recovery codes, remove two-step verification so they can sign in with their password and set it up again.</p></div></div><button type="button" className="button-secondary" onClick={resetTwoFactor}>Reset two-step verification</button></section></div>
    </div>
  </>
}
