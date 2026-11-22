import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import api, { apiErrorMessage } from '../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../components/ui/States.jsx'
import './AnalyticsPage.css'

const adminReports = ['performance', 'students', 'teachers', 'faculties', 'departments', 'classes']
const colors = ['var(--blue)', 'var(--green)', '#e2a63b', '#8b70dc', '#dd6b78', '#39a9b4']
const labels = { performance: 'Performance', students: 'Students', teachers: 'Teachers', faculties: 'Faculties', departments: 'Departments', classes: 'Classes' }
const pct = (value) => value == null ? '—' : `${Number(value).toFixed(1)}%`

function Metric({ title, value, note }) { return <article className="metric-card analytics-metric"><div className="metric-label">{title}</div><div className="metric-value">{value ?? 0}</div><div className="metric-note">{note}</div></article> }
function Panel({ title, note, children }) { return <section className="panel analytics-panel"><div className="panel-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div></div>{children}</section> }
function ChartEmpty() { return <div className="analytics-empty">No records match these filters.</div> }

const ringPalette = [
  { start: '#2DABDE', end: '#16A355' },
  { start: '#8ad6ef', end: '#138f50' },
  { start: '#b59aff', end: '#7255c8' },
]

function ScoreRings({ values }) {
  return <div className="analytics-score-rings">{values.map(([label, value], index) => {
    const score = value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.min(100, Number(value)))
    const gradientId = `score-ring-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`
    const palette = ringPalette[index % ringPalette.length]
    return <div className="analytics-score-ring" key={label}>
      <div className="analytics-score-ring-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><defs><linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor={palette.start} /><stop offset="100%" stopColor={palette.end} /></linearGradient></defs><Pie data={[{ name: label, value: score ?? 0 }, { name: 'Remaining', value: 100 - (score ?? 0) }]} dataKey="value" cx="50%" cy="50%" innerRadius="72%" outerRadius="94%" startAngle={90} endAngle={-270} paddingAngle={score == null ? 0 : 2} cornerRadius={8} stroke="none"><Cell fill={score == null ? '#e9eef5' : `url(#${gradientId})`} /><Cell fill="#e9eef5" /></Pie><Tooltip formatter={(amount, name) => [name === 'Remaining' ? `${Number(amount).toFixed(0)} points to 100` : pct(amount), name]} /></PieChart></ResponsiveContainer><div className="analytics-score-ring-center"><b>{score == null ? '—' : `${score.toFixed(0)}%`}</b></div></div>
      <span>{label}</span>
    </div>
  })}</div>
}

function SubmissionBreakdown({ submitted = 0, missing = 0, pending }) {
  const submittedCount = Number(submitted) || 0
  const missingCount = Number(missing) || 0
  const total = submittedCount + missingCount
  const rate = total ? Math.round(submittedCount / total * 100) : null
  return <div className="analytics-submission-breakdown">
    <div className="analytics-submission-donut">
      {total ? <><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Submitted', value: submittedCount }, { name: 'Missing', value: missingCount }]} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="67%" outerRadius="93%" paddingAngle={submittedCount && missingCount ? 4 : 0} cornerRadius={7} stroke="none"><Cell fill="var(--blue)" /><Cell fill="#e5eaf2" /></Pie><Tooltip formatter={(value, name) => [value, name]} /></PieChart></ResponsiveContainer><div className="analytics-submission-center"><b>{rate}%</b><span>submitted</span></div></> : <div className="analytics-submission-no-data"><b>—</b><span>No work yet</span></div>}
    </div>
    <div className="analytics-submission-legend"><div><i className="submitted-dot" /><span>Submitted</span><b>{submittedCount}</b></div><div><i className="missing-dot" /><span>Missing</span><b>{missingCount}</b></div>{pending != null && <div><i className="pending-dot" /><span>Pending grade</span><b>{Number(pending) || 0}</b></div>}<small>{total ? `${total} assignments in this view` : 'Published assignments will appear here.'}</small></div>
  </div>
}

export default function AnalyticsPage() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const isTeacher = user.role === 'teacher'
  const [overview, setOverview] = useState(null)
  const [detail, setDetail] = useState(null)
  const [directory, setDirectory] = useState([])
  const [directoryTab, setDirectoryTab] = useState('performance')
  const [options, setOptions] = useState({ faculties: [], departments: [], classes: [], teachers: [], students: [], assignments: [], quizzes: [] })
  const [classId, setClassId] = useState('')
  const [filters, setFilters] = useState({ from: '', to: '', facultyId: '', departmentId: '', classId: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (isAdmin) {
        const [{ data: result }, { data: opts }, ...directories] = await Promise.all([
          api.get('/admin/analytics/overview', { params }), api.get('/academic/options'),
          ...['teachers', 'students', 'assignments', 'quizzes'].map((type) => api.get(`/admin/analytics/${type}`, { params: { limit: 100 } })),
        ])
        setOverview(result); setOptions({ ...opts, teachers: directories[0].data.records, students: directories[1].data.records, assignments: directories[2].data.records, quizzes: directories[3].data.records })
        const directoryPath = directoryTab === 'performance' ? '/admin/analytics/performance' : `/admin/analytics/${directoryTab}`
        const { data: list } = await api.get(directoryPath, { params: { ...params, limit: 50 } })
        setDirectory(directoryTab === 'performance' ? list.records : list.records)
      } else if (isTeacher) {
        const { data: result } = await api.get('/teacher/analytics/overview', { params })
        setOverview(result)
        const selected = classId || result.classes[0]?._id || ''
        setClassId(selected)
        if (selected) { const { data: classResult } = await api.get(`/teacher/analytics/classes/${selected}`, { params }); setDetail(classResult) } else setDetail(null)
      } else {
        const { data: result } = await api.get('/student/analytics/performance', { params })
        setDetail(result)
      }
    } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }, [isAdmin, isTeacher, params, directoryTab, classId])

  useEffect(() => { load() }, [load])

  async function exportReport(format) {
    setExporting(format)
    try {
      const exportParams = { ...params, ...(isTeacher && classId ? { classId } : {}), report: directoryTab }
      const { data } = await api.get(`/reports/export/${format}`, { params: exportParams, responseType: 'blob' })
      const extension = format === 'excel' ? 'xlsx' : format
      const href = URL.createObjectURL(data)
      const reportName = user.role === 'student' && format === 'pdf' ? 'my-academic-performance' : 'lms-report'
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${reportName}-${new Date().toISOString().slice(0, 10)}.${extension}`; anchor.click(); URL.revokeObjectURL(href)
      toast.success(`${format.toUpperCase()} report downloaded`)
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setExporting('') }
  }

  function changeFilter(name, value) { setFilters((current) => ({ ...current, [name]: value, ...(name === 'facultyId' ? { departmentId: '', classId: '' } : {}), ...(name === 'departmentId' ? { classId: '' } : {}) })) }

  if (loading && !overview && !detail) return <PageLoading />
  if (error && !overview && !detail) return <ErrorState message={error} onRetry={load} />
  const metrics = overview?.metrics || detail?.summary || {}
  const studentScoreRows = [...(detail?.assignments || []).flatMap((item) => {
    const marks = item.marksAwarded
    const maximum = item.totalMarks
    return marks == null || !maximum ? [] : [{ label: item.title, score: Number(marks) / Number(maximum) * 100, category: 'Assignment' }]
  }), ...(detail?.quizzes || []).flatMap((item) => {
    const marks = item.score
    const maximum = item.maxScore
    return marks == null || !maximum || item.status !== 'graded' ? [] : [{ label: item.title, score: Number(marks) / Number(maximum) * 100, category: 'Quiz' }]
  })].slice(-8)
  const classRows = isTeacher ? overview?.classes || [] : overview?.classes || []
  const departmentOptions = options.departments.filter((item) => !filters.facultyId || String(item.faculty) === filters.facultyId)
  const classOptions = options.classes.filter((item) => !filters.departmentId || String(item.department?._id || item.department) === filters.departmentId)

  return <div className="analytics-page">
    <div className="section-title-row"><div><div className="section-kicker">REPORTS & ANALYTICS</div><h1>{isAdmin ? 'University analytics' : isTeacher ? 'Teaching analytics' : 'My academic performance'}</h1><p>{isAdmin ? 'Explore real academic activity across the university.' : isTeacher ? 'Review progress across your assigned classes.' : 'Your results and coursework status, based on graded records.'}</p></div><div className="analytics-export-actions">{[['pdf', FileText], ['excel', FileSpreadsheet], ['csv', Download]].map(([format, Icon]) => <button key={format} className="button-secondary" onClick={() => exportReport(format)} disabled={Boolean(exporting)}><Icon size={14} />{exporting === format ? 'Preparing…' : format === 'excel' ? 'Excel' : format.toUpperCase()}</button>)}</div></div>
    <div className="analytics-filters">
      <label>From<input type="date" value={filters.from} onChange={(e) => changeFilter('from', e.target.value)} /></label><label>To<input type="date" value={filters.to} onChange={(e) => changeFilter('to', e.target.value)} /></label>
      {isAdmin && <><label>Faculty<select value={filters.facultyId} onChange={(e) => changeFilter('facultyId', e.target.value)}><option value="">All faculties</option>{options.faculties.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label><label>Department<select value={filters.departmentId} onChange={(e) => changeFilter('departmentId', e.target.value)}><option value="">All departments</option>{departmentOptions.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label><label>Class<select value={filters.classId} onChange={(e) => changeFilter('classId', e.target.value)}><option value="">All classes</option>{classOptions.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label><label>Teacher<select value={filters.teacherId || ''} onChange={(e) => changeFilter('teacherId', e.target.value)}><option value="">All teachers</option>{options.teachers.map((item) => <option value={item._id} key={item._id}>{item.fullName}</option>)}</select></label><label>Student<select value={filters.studentId || ''} onChange={(e) => changeFilter('studentId', e.target.value)}><option value="">All students</option>{options.students.map((item) => <option value={item._id} key={item._id}>{item.fullName} · {item.studentId}</option>)}</select></label><label>Assignment<select value={filters.assignmentId || ''} onChange={(e) => changeFilter('assignmentId', e.target.value)}><option value="">All assignments</option>{options.assignments.map((item) => <option value={item._id} key={item._id}>{item.title}</option>)}</select></label><label>Quiz<select value={filters.quizId || ''} onChange={(e) => changeFilter('quizId', e.target.value)}><option value="">All quizzes</option>{options.quizzes.map((item) => <option value={item._id} key={item._id}>{item.title}</option>)}</select></label></>}
      {isTeacher && <label>Class<select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Choose class</option>{classRows.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>}
      <button className="icon-button analytics-refresh" aria-label="Refresh reports" onClick={load}><RefreshCw size={15} /></button>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {loading ? <PageLoading /> : <>
      {isAdmin && <>
        <div className="metrics-grid metrics-four"><Metric title="Students" value={metrics.students} note="All classes in scope" /><Metric title="Active students" value={metrics.activeStudents} note="Can sign in" /><Metric title="Inactive students" value={metrics.inactiveStudents} note="Access disabled" /><Metric title="Teachers" value={metrics.teachers} note="Teaching accounts" /><Metric title="Faculties" value={metrics.faculties} note="Academic units" /><Metric title="Departments" value={metrics.departments} note="Academic units" /><Metric title="Classes" value={metrics.classes} note="Academic groups" /><Metric title="Assignments" value={metrics.assignments} note={`${metrics.submittedAssignments || 0} submissions`} /><Metric title="Quiz attempts" value={metrics.totalQuizAttempts} note="Recorded attempts" /><Metric title="Assignment average" value={pct(metrics.assignmentAverage)} note="Graded submissions only" /><Metric title="Quiz average" value={pct(metrics.quizAverage)} note="Graded attempts only" /></div>
        <div className="analytics-highlight-grid"><Panel title="Performance snapshot" note="Average results from graded work"><ScoreRings values={[["Assignments", metrics.assignmentAverage], ["Quizzes", metrics.quizAverage], ["Overall", metrics.overallPerformance]]} /></Panel><Panel title="Assignment submissions" note="Submitted work compared with missing work"><SubmissionBreakdown submitted={metrics.submittedAssignments} missing={metrics.missingSubmissions} /></Panel></div>
        <div className="analytics-chart-grid">
          <Panel title="Students by faculty"><Chart data={overview?.studentsByFaculty} kind="bar" keyField="name" valueField="students" /></Panel>
          <Panel title="Students by department"><Chart data={overview?.studentsByDepartment} kind="bar" keyField="name" valueField="students" /></Panel>
          <Panel title="Registration trend" note="Student registrations by month"><Chart data={overview?.registrationTrend} kind="line" keyField="_id" valueField="registrations" /></Panel>
          <Panel title="Graded performance trend" note="Monthly average percentages from graded work">{overview?.performanceTrend?.length ? <ResponsiveContainer width="100%" height={250}><AreaChart data={overview.performanceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip formatter={(value) => pct(value)} /><Legend /><Area type="monotone" dataKey="assignments" name="Assignment %" stroke="var(--blue)" fill="var(--blue-soft)" /><Area type="monotone" dataKey="quizzes" name="Quiz %" stroke="var(--green)" fill="var(--green-soft)" /></AreaChart></ResponsiveContainer> : <ChartEmpty />}</Panel>
          <Panel title="Assignment submissions by month"><Chart data={overview?.assignmentSubmissionTrend} kind="bar" keyField="_id" valueField="submissions" /></Panel>
          <Panel title="Quiz participation by month"><Chart data={overview?.quizParticipationTrend} kind="bar" keyField="_id" valueField="attempts" /></Panel>
          <Panel title="Teachers by department"><Chart data={overview?.teachersByDepartment} kind="bar" keyField="name" valueField="teachers" /></Panel>
          <Panel title="Classes by department"><Chart data={overview?.classesByDepartment} kind="bar" keyField="name" valueField="classes" /></Panel>
          <Panel title="Assignment and quiz activity by department">{overview?.departmentAcademicActivity?.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={overview.departmentAcademicActivity}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="assignments" fill="var(--blue)" /><Bar dataKey="quizzes" fill="var(--green)" /></BarChart></ResponsiveContainer> : <ChartEmpty />}</Panel>
          <Panel title="Students by class"><Chart data={overview?.studentsByClass} kind="bar" keyField="name" valueField="students" /></Panel>
          <Panel title="Faculty academic activity">{overview?.academicActivityByFaculty?.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={overview.academicActivityByFaculty}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="assignments" fill="var(--blue)" /><Bar dataKey="quizzes" fill="var(--green)" /></BarChart></ResponsiveContainer> : <ChartEmpty />}</Panel>
        </div>
        <Panel title="Academic reports" note="Filter and inspect university records"><div className="analytics-tabs">{adminReports.map((tab) => <button className={directoryTab === tab ? 'analytics-tab-active' : ''} key={tab} onClick={() => setDirectoryTab(tab)}>{labels[tab]}</button>)}</div><DirectoryTable rows={directory} tab={directoryTab} /></Panel>
      </>}
      {isTeacher && <>
        <div className="metrics-grid metrics-four"><Metric title="Assigned classes" value={metrics.classes} note="Authorized classes" /><Metric title="Students" value={metrics.students} note="In assigned classes" /><Metric title="Lessons" value={metrics.lessons} note="Published" /><Metric title="Assignments" value={metrics.assignments} note="Published to class" /><Metric title="Submission rate" value={pct(detail?.class?.submissionRate)} note="Across published work" /><Metric title="Pending grading" value={Math.max(0, (detail?.class?.submittedAssignments || 0) - (detail?.class?.gradedAssignments || 0))} note="Awaiting a grade" /><Metric title="Missing submissions" value={detail?.class?.missingSubmissions || 0} note="Across published work" /><Metric title="Quiz average" value={pct(detail?.class?.quizAverage)} note="Graded attempts only" /></div>
        {detail?.class && <div className="analytics-highlight-grid"><Panel title="Class performance snapshot" note="Class averages from graded work"><ScoreRings values={[["Assignments", detail.class.assignmentAverage], ["Quizzes", detail.class.quizAverage], ["Submission rate", detail.class.submissionRate]]} /></Panel><Panel title="Submission status" note="Class assignment workload"><SubmissionBreakdown submitted={detail.class.submittedAssignments} missing={detail.class.missingSubmissions} pending={Math.max(0, (detail.class.submittedAssignments || 0) - (detail.class.gradedAssignments || 0))} /></Panel></div>}
        {detail?.class && <div className="analytics-chart-grid"><Panel title={`${detail.class.name} performance`} note="Actual graded student results"><ResponsiveContainer width="100%" height={270}><BarChart data={detail.students || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="student.studentId" /><YAxis domain={[0, 100]} /><Tooltip formatter={(value) => pct(value)} /><Legend /><Bar dataKey="assignmentAverage" name="Assignment %" fill="var(--blue)" /><Bar dataKey="quizAverage" name="Quiz %" fill="var(--green)" /></BarChart></ResponsiveContainer></Panel><Panel title="Class performance trend" note="Average of graded work by month"><ResponsiveContainer width="100%" height={250}><AreaChart data={detail.performanceTrend || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip formatter={(value) => pct(value)} /><Legend /><Area type="monotone" dataKey="assignmentAverage" name="Assignment %" stroke="var(--blue)" fill="var(--blue-soft)" /><Area type="monotone" dataKey="quizAverage" name="Quiz %" stroke="var(--green)" fill="var(--green-soft)" /></AreaChart></ResponsiveContainer></Panel><Panel title="Class completion"><Chart data={[{ name: 'Submitted', value: detail.class.submittedAssignments || 0 }, { name: 'Missing', value: detail.class.missingSubmissions || 0 }]} kind="pie" keyField="name" valueField="value" /></Panel><Panel title="Students needing attention"><DirectoryTable rows={detail.attentionStudents || []} tab="attention" /></Panel><Panel title="Top performers"><DirectoryTable rows={detail.topStudents || []} tab="top" /></Panel></div>}
      </>}
      {!isAdmin && !isTeacher && <>
        <div className="student-report-identity"><b>{detail?.student?.fullName}</b><span>Student ID: {detail?.student?.studentId || '—'}</span><span>{detail?.student?.class?.department?.faculty?.name || 'Faculty unavailable'} · {detail?.student?.class?.department?.name || 'Department unavailable'} · {detail?.student?.class?.name || 'Class unavailable'}</span></div>
        <div className="metrics-grid metrics-four"><Metric title="Assignment average" value={pct(metrics.assignmentAverage)} note="Graded assignments only" /><Metric title="Quiz average" value={pct(metrics.quizAverage)} note="Released graded results" /><Metric title="Overall performance" value={pct(metrics.overallPerformance)} note="Weighted by graded items" /><Metric title="Assignments submitted" value={metrics.submittedAssignments} note="Includes pending and graded" /><Metric title="Missing assignments" value={metrics.missingAssignments} note="Published class work" /><Metric title="Pending grades" value={metrics.pendingAssignments} note="Submitted, awaiting grading" /><Metric title="Completed quizzes" value={metrics.completedQuizzes} note="Submitted attempts" /></div>
        <div className="analytics-highlight-grid"><Panel title="Performance snapshot" note="Your average on graded assessments"><ScoreRings values={[["Assignments", metrics.assignmentAverage], ["Quizzes", metrics.quizAverage], ["Overall", metrics.overallPerformance]]} /></Panel><Panel title="Assignment progress" note="Submitted work compared with missing work"><SubmissionBreakdown submitted={metrics.submittedAssignments} missing={metrics.missingAssignments} pending={metrics.pendingAssignments} /></Panel></div>
        <div className="analytics-chart-grid"><Panel title="Graded performance" note="Average scores across graded work">{[{ name: 'Assignments', average: metrics.assignmentAverage }, { name: 'Quizzes', average: metrics.quizAverage }].filter((item) => item.average != null).length ? <ResponsiveContainer width="100%" height={250}><BarChart data={[{ name: 'Assignments', average: metrics.assignmentAverage }, { name: 'Quizzes', average: metrics.quizAverage }].filter((item) => item.average != null)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value) => pct(value)} /><Bar dataKey="average" fill="var(--blue)" radius={[5, 5, 0, 0]} maxBarSize={64} /></BarChart></ResponsiveContainer> : <ChartEmpty />}</Panel><Panel title="Recent assessment scores" note="Your latest graded assignments and quizzes">{studentScoreRows.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={studentScoreRows} margin={{ top: 8, right: 12, left: -12, bottom: 38 }}><CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" /><XAxis dataKey="label" interval={0} angle={-22} textAnchor="end" height={54} tick={{ fill: '#8290a4', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: '#8290a4', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [pct(value), 'Score']} labelFormatter={(label) => `${studentScoreRows.find((item) => item.label === label)?.category || 'Assessment'} · ${label}`} cursor={{ fill: 'var(--blue-soft)' }} /><Bar dataKey="score" radius={[5, 5, 0, 0]} maxBarSize={36}>{studentScoreRows.map((item, index) => <Cell key={`${item.category}-${item.label}-${index}`} fill={item.category === 'Quiz' ? 'var(--green)' : 'var(--blue)'} />)}</Bar></BarChart></ResponsiveContainer> : <ChartEmpty />}</Panel><Panel title="Assignment results"><ResultTable rows={detail?.assignments || []} /></Panel><Panel title="Quiz participation"><ResultTable rows={detail?.quizzes || []} /></Panel></div>
      </>}
    </>}
  </div>
}

function Chart({ data = [], kind, keyField, valueField }) {
  if (!data.length) return <ChartEmpty />
  if (kind === 'pie') return <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={data} dataKey={valueField} nameKey={keyField} outerRadius={86} label>{data.map((item, index) => <Cell key={item[keyField]} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
  const Component = kind === 'area' ? AreaChart : kind === 'line' ? LineChart : BarChart
  return <ResponsiveContainer width="100%" height={250}><Component data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={keyField} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip />{kind === 'area' ? <Area dataKey={valueField} stroke="var(--blue)" fill="var(--blue-soft)" /> : kind === 'line' ? <Line type="monotone" dataKey={valueField} stroke="var(--blue)" strokeWidth={2} /> : <Bar dataKey={valueField} fill="var(--blue)" radius={[4, 4, 0, 0]} />}</Component></ResponsiveContainer>
}

function DirectoryTable({ rows = [], tab }) {
  if (!rows.length) return <EmptyState title="No matching records" description="Try changing the filters or date range." />
  if (tab === 'performance' || tab === 'top' || tab === 'attention') return <div className="table-scroll"><table><thead><tr><th>Student</th><th>Student ID</th><th>Assignment avg.</th><th>Quiz avg.</th><th>Overall</th></tr></thead><tbody>{rows.map((row) => <tr key={row.student?.id || row.student?._id}><td>{row.student?.fullName}</td><td>{row.student?.studentId}</td><td>{pct(row.assignmentAverage)}</td><td>{pct(row.quizAverage)}</td><td>{pct(row.overallAverage)}</td></tr>)}</tbody></table></div>
  const first = rows[0]
  const fields = Object.keys(first).filter((field) => !['_id', '__v', 'passwordHash'].includes(field) && (typeof first[field] !== 'object' || first[field] == null)).slice(0, 5)
  return <div className="table-scroll"><table><thead><tr>{fields.map((field) => <th key={field}>{field.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row._id}>{fields.map((field) => <td key={field}>{field === 'isActive' ? row[field] ? 'Active' : 'Inactive' : row[field] == null ? '—' : String(row[field])}</td>)}</tr>)}</tbody></table></div>
}

function ResultTable({ rows }) {
  if (!rows.length) return <ChartEmpty />
  return <div className="table-scroll"><table><thead><tr><th>Item</th><th>Status</th><th>Score</th><th>Date</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.status.replace('_', ' ')}</td><td>{item.marksAwarded != null ? `${item.marksAwarded} / ${item.totalMarks}` : item.score != null ? `${item.score} / ${item.maxScore}` : '—'}</td><td>{item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>
}
