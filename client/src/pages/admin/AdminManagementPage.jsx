import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronLeft, ChevronRight, Eye, Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import ProfileAvatar from '../../components/common/ProfileAvatar.jsx'

const resourceInfo = {
  faculties: { label: 'Faculties', singular: 'faculty', icon: Building2, parent: null },
  departments: { label: 'Departments', singular: 'department', icon: Building2, parent: 'faculty' },
  classes: { label: 'Classes', singular: 'class', icon: Building2, parent: 'department' },
  teachers: { label: 'Teachers', singular: 'teacher', icon: UsersRound, parent: 'department' },
  students: { label: 'Students', singular: 'student', icon: UsersRound, parent: 'class' },
}
const emptyForm = { name: '', code: '', classCode: '', description: '', level: '', fullName: '', email: '', password: '', studentId: '', faculty: '', department: '', class: '', assignedClasses: [] }

export default function AdminManagementPage({ resource = 'faculties' }) {
  const config = resourceInfo[resource]
  const isAcademic = ['faculties', 'departments', 'classes'].includes(resource)
  const [records, setRecords] = useState([])
  const [options, setOptions] = useState({ faculties: [], departments: [], classes: [] })
  const [filterCatalog, setFilterCatalog] = useState({ faculties: [], departments: [], classes: [] })
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [faculty, setFaculty] = useState('')
  const [department, setDepartment] = useState('')
  const [classId, setClassId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [details, setDetails] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const availableDepartments = useMemo(() => filterCatalog.departments.filter((item) => !faculty || String(item.faculty?._id || item.faculty) === faculty), [filterCatalog.departments, faculty])
  const formDepartments = useMemo(() => options.departments.filter((item) => !form.faculty || String(item.faculty?._id || item.faculty) === form.faculty), [options.departments, form.faculty])
  const formClasses = useMemo(() => options.classes.filter((item) => String(item.department?._id || item.department) === form.department), [options.classes, form.department])
  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search.trim()) params.set('search', search.trim())
      if (status !== 'all') params.set('status', status)
      if (['departments', 'classes', 'teachers', 'students'].includes(resource) && faculty) params.set('faculty', faculty)
      if (['classes', 'teachers', 'students'].includes(resource) && department) params.set('department', department)
      if (['teachers', 'students'].includes(resource) && classId) params.set('class', classId)
      const [listResult, optionsResult, facultyResult, departmentResult, classResult] = await Promise.all([
        api.get(`/${resource}?${params.toString()}`),
        api.get('/academic/options'),
        api.get('/faculties?limit=100'),
        api.get('/departments?limit=100'),
        api.get('/classes?limit=100'),
      ])
      const key = isAcademic ? 'records' : resource
      setRecords(listResult.data[key] || [])
      setPagination(listResult.data.pagination || { page: 1, limit: 20, total: 0, pages: 0 })
      setOptions(optionsResult.data)
      setFilterCatalog({ faculties: facultyResult.data.records, departments: departmentResult.data.records, classes: classResult.data.records })
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [resource, page, search, status, faculty, department, classId])

  function resetForm() {
    setForm(emptyForm)
    setEditing(null)
    setFormOpen(false)
  }

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  function startEdit(record) {
    if (isAcademic) {
      setForm({ ...emptyForm, name: record.name || '', code: record.code || '', classCode: record.classCode || '', description: record.description || '', level: record.level || '', faculty: String(record.faculty?._id || record.faculty || ''), department: String(record.department?._id || record.department || '') })
    } else if (resource === 'teachers') {
      setForm({ ...emptyForm, fullName: record.fullName || '', email: record.email || '', department: String(record.department?._id || ''), assignedClasses: (record.assignedClasses || []).map((item) => String(item._id)) })
    } else {
      const recordFaculty = record.class?.department?.faculty?._id || ''
      setForm({ ...emptyForm, fullName: record.fullName || '', email: record.email || '', studentId: record.studentId || '', faculty: String(recordFaculty), department: String(record.department?._id || record.class?.department?._id || ''), class: String(record.class?._id || '') })
    }
    setEditing(record)
    setFormOpen(true)
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    const payload = isAcademic
      ? resource === 'faculties'
        ? { name: form.name, code: form.code, description: form.description }
        : resource === 'departments'
          ? { name: form.name, code: form.code, description: form.description, faculty: form.faculty }
          : { name: form.name, classCode: form.classCode, description: form.description, department: form.department, level: form.level }
      : resource === 'teachers'
        ? { fullName: form.fullName, email: form.email }
        : { fullName: form.fullName, email: form.email, studentId: form.studentId, faculty: form.faculty, department: form.department, class: form.class }
    if (resource === 'teachers' && !editing) payload.password = form.password
    try {
      if (editing) await api.put(`/${resource}/${editing._id}`, payload)
      else await api.post(`/${resource}`, payload)
      toast.success(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} ${editing ? 'updated' : 'created'}`)
      resetForm()
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(record) {
    const subject = isAcademic ? record.name : record.fullName
    const action = record.isActive ? 'deactivate' : 'reactivate'
    if (!window.confirm(`Are you sure you want to ${action} ${subject}?`)) return
    try {
      await api.patch(`/${resource}/${record._id}/status`, { isActive: !record.isActive })
      toast.success(`${subject} ${record.isActive ? 'deactivated' : 'reactivated'}`)
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    }
  }

  async function deleteRecord(record) {
    const subject = isAcademic ? record.name : record.fullName
    const warning = resource === 'faculties'
      ? ' This permanently deletes its departments, classes, users, courses, lessons, assignments, quizzes, and related submissions.'
      : resource === 'departments'
        ? ' This permanently deletes its classes, users, courses, lessons, assignments, quizzes, and related submissions.'
        : resource === 'classes'
          ? ' This permanently deletes students in this class, courses, lessons, assignments, quizzes, and submissions.'
          : resource === 'teachers'
            ? ' This permanently deletes their lessons, assignments, quizzes, messages, and related submissions.'
            : ' This permanently deletes the student account, submissions, quiz attempts, and conversations.'
    if (!window.confirm(`Permanently delete ${config.singular} “${subject}”?${warning}`)) return
    setDeletingId(String(record._id))
    try {
      await api.delete(`/${resource}/${record._id}`)
      toast.success(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} and related records deleted`)
      if (records.length === 1 && page > 1) setPage((current) => Math.max(1, current - 1))
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setDeletingId('')
    }
  }

  async function viewDetails(record) {
    if (isAcademic) {
      try {
        const { data } = await api.get(`/${resource}/${record._id}`)
        setDetails(data.record)
      } catch (requestError) {
        toast.error(apiErrorMessage(requestError))
      }
    }
  }

  const title = config.label
  const Icon = config.icon

  return <>
    <div className="section-title-row"><div><div className="section-kicker">UNIVERSITY ADMINISTRATION</div><h1>{title}</h1><p>Manage {title.toLowerCase()} and maintain accurate university records.</p></div><button className="button-primary" onClick={startCreate}><Plus size={16} />Add {config.singular}</button></div>
    <div className="panel admin-list-panel">
      <div className="admin-list-toolbar"><label className="search-field"><Search size={16} /><input aria-label={`Search ${title.toLowerCase()}`} placeholder={resource === 'students' ? 'Search name, email, or Student ID' : `Search ${title.toLowerCase()}…`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
        <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        {['departments', 'classes', 'teachers', 'students'].includes(resource) && <select aria-label="Filter by faculty" value={faculty} onChange={(event) => { setFaculty(event.target.value); setDepartment(''); setClassId(''); setPage(1) }}><option value="">All faculties</option>{filterCatalog.faculties.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select>}
        {['classes', 'teachers', 'students'].includes(resource) && <select aria-label="Filter by department" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1) }}><option value="">All departments</option>{availableDepartments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select>}
        {['teachers', 'students'].includes(resource) && <select aria-label="Filter by class" value={classId} onChange={(event) => { setClassId(event.target.value); setPage(1) }}><option value="">All classes</option>{filterCatalog.classes.filter((item) => (!department || String(item.department?._id || item.department) === department) && (!faculty || String(item.department?.faculty?._id || item.department?.faculty) === faculty)).map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select>}
      </div>
      <div className="panel-heading admin-table-heading"><div><h2>{title}</h2><p>{pagination.total} total records</p></div><Icon size={18} className="panel-heading-icon" /></div>
      {error ? <ErrorState message={error} onRetry={load} /> : loading ? <PageLoading /> : records.length ? <div className="table-scroll"><table><thead><tr>{isAcademic ? <><th>Name</th><th>{resource === 'classes' ? 'Class code' : 'Code'}</th>{config.parent && <th>{config.parent === 'faculty' ? 'Faculty' : 'Department'}</th>}{resource === 'classes' && <th>Level</th>}</> : <><th>Person</th>{resource === 'students' && <th>Student ID</th>}<th>Email</th><th>{resource === 'teachers' ? 'Classes' : 'Class'}</th></>}<th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>{records.map((record) => <tr key={record._id}>
        {isAcademic ? <><td><b>{record.name}</b><small className="table-secondary">{record.description || '—'}</small></td><td><span className="code-pill">{record.classCode || record.code}</span></td>{config.parent && <td>{resource === 'departments' ? record.faculty?.name || '—' : resource === 'classes' ? record.department?.name || '—' : record.department?.name || record.class?.department?.name || '—'}</td>}{resource === 'classes' && <td>{record.level || '—'}</td>}</> : <><td><Link className="admin-person-link" to={`/app/${resource}/${record._id}`}><ProfileAvatar user={record} size="small" /><span><b>{record.fullName}</b><small>{resource === 'students' ? record.class?.department?.faculty?.name || '' : record.role}</small></span></Link></td>{resource === 'students' && <td><span className="code-pill">{record.studentId}</span></td>}<td>{record.email}</td><td>{resource === 'teachers' ? `${record.assignedClasses?.length || 0} classes` : record.class?.name || '—'}</td></>}
        <td><span className={`status-pill ${record.isActive ? 'status-complete' : 'status-inactive'}`}>{record.isActive ? 'Active' : 'Inactive'}</span></td><td>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(record.createdAt))}</td><td><div className="admin-row-actions">{isAcademic ? <button className="table-action" onClick={() => viewDetails(record)} title="View details" aria-label={`View ${record.name}`}><Eye size={14} /></button> : <Link className="table-action" to={`/app/${resource}/${record._id}`} title="View details" aria-label={`View ${record.fullName}`}><Eye size={14} /></Link>}<button className="table-action" onClick={() => startEdit(record)} title="Edit record" aria-label={`Edit ${isAcademic ? record.name : record.fullName}`}><Pencil size={14} /></button><button className="table-action" onClick={() => toggleStatus(record)}>{record.isActive ? 'Deactivate' : 'Activate'}</button><button className="table-action danger-icon" onClick={() => deleteRecord(record)} disabled={deletingId === String(record._id)} title="Permanently delete" aria-label={`Delete ${isAcademic ? record.name : record.fullName}`}><Trash2 size={14} /></button></div></td>
      </tr>)}</tbody></table></div> : <EmptyState title={`No ${title.toLowerCase()} found`} description={search || status !== 'all' ? 'Adjust your search or filters and try again.' : `Create your first ${config.singular} record to get started.`} />}
      {!loading && !error && pagination.pages > 1 && <div className="admin-pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} />Previous</button><button className="button-secondary" disabled={page >= pagination.pages} onClick={() => setPage((value) => Math.min(pagination.pages, value + 1))}>Next<ChevronRight size={15} /></button></div></div>}
    </div>

    {formOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resetForm() }}><section className="panel admin-form-modal" role="dialog" aria-modal="true" aria-labelledby="admin-form-title"><div className="panel-heading"><div><h2 id="admin-form-title">{editing ? 'Edit' : 'Create'} {config.singular}</h2><p>Changes are validated and saved to the university database.</p></div><button className="button-quiet" onClick={resetForm}>Cancel</button></div>
      <form className="form-grid" onSubmit={save}>
        {isAcademic ? <><label>Name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>{resource === 'classes' ? <label>Class code<input required maxLength={30} value={form.classCode} onChange={(event) => setForm({ ...form, classCode: event.target.value })} /></label> : <label>Code<input required maxLength={20} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>}{resource === 'departments' && <label>Faculty<select required value={form.faculty} onChange={(event) => setForm({ ...form, faculty: event.target.value })}><option value="">Choose active faculty</option>{options.faculties.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.code}</option>)}</select></label>}{resource === 'classes' && <><label>Department<select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}><option value="">Choose active department</option>{options.departments.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.code}</option>)}</select></label><label>Level (optional)<input maxLength={60} value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} placeholder="e.g. Year 2" /></label></>}<label className="form-grid-span">Description<textarea rows="3" maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></> : <><label>Full name<input required maxLength={160} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><label>Email address<input type="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{resource === 'students' && <label>Student ID<input required maxLength={40} value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} /></label>}{resource === 'teachers' && !editing && <label>Temporary password<input type="password" required minLength={8} maxLength={72} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}{resource === 'students' && <><label>Faculty<select required value={form.faculty} onChange={(event) => setForm({ ...form, faculty: event.target.value, department: '', class: '' })}><option value="">Choose active faculty</option>{options.faculties.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Department<select required disabled={!form.faculty} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value, class: '' })}><option value="">Choose active department</option>{formDepartments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Class<select required disabled={!form.department} value={form.class} onChange={(event) => setForm({ ...form, class: event.target.value })}><option value="">Choose active class</option>{formClasses.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></label></>}</>}
        <div className="form-actions form-grid-span"><button className="button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : `Create ${config.singular}`}</button></div>
      </form></section></div>}
    {details && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(null) }}><section className="panel admin-form-modal" role="dialog" aria-modal="true"><div className="panel-heading"><div><h2>{details.name}</h2><p>{config.singular[0].toUpperCase() + config.singular.slice(1)} details</p></div><button className="button-quiet" onClick={() => setDetails(null)}>Close</button></div><dl className="profile-details"><div><dt>Code</dt><dd>{details.code || details.classCode}</dd></div>{details.faculty && <div><dt>Faculty</dt><dd>{details.faculty.name}</dd></div>}{details.department && <div><dt>Department</dt><dd>{details.department.name}</dd></div>}<div><dt>Description</dt><dd>{details.description || '—'}</dd></div><div><dt>Status</dt><dd>{details.isActive ? 'Active' : 'Inactive'}</dd></div><div><dt>Created</dt><dd>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(details.createdAt))}</dd></div></dl></section></div>}
  </>
}
