import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpenCheck, Building2, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, GraduationCap, LibraryBig, ShieldCheck, UsersRound } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../context/AuthContext.jsx'
import api from '../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../components/ui/States.jsx'
import ProfileAvatar from '../components/common/ProfileAvatar.jsx'
import './StudentCourseGroups.css'
import StudentWeeklyLearning from './student/StudentWeeklyLearning.jsx'
import DashboardNotesWidget from '../components/notes/DashboardNotesWidget.jsx'

const metricIcons = { students: UsersRound, teachers: GraduationCap, classes: LibraryBig, lessons: BookOpenCheck, assignments: ClipboardCheck, quizzes: CalendarDays }
const toneCycle = ['blue', 'green', 'amber', 'violet']

function MetricCard({ label, value = 0, note, icon: Icon, tone = 'blue' }) {
  return <article className="metric-card"><div className={`metric-icon metric-${tone}`}><Icon size={19} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>
}

function SectionHeading({ eyebrow, title, description, action, onAction }) {
  return <div className="section-title-row"><div><div className="section-kicker">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <button className="button-secondary" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>
}

function AdminDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const load = () => api.get('/admin/dashboard/stats').then(({ data: result }) => { setData(result); setError('') }).catch((e) => setError(e.response?.data?.message || 'Could not load the dashboard'))
  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    window.addEventListener('focus', load)
    return () => { clearInterval(interval); window.removeEventListener('focus', load) }
  }, [])
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <PageLoading />
  const stats = data.metrics
  const roleChart = [{ name: 'Students', value: stats.students, color: 'var(--blue)' }, { name: 'Teachers', value: stats.teachers, color: 'var(--green)' }]
  const statusChart = [{ name: 'Active', value: stats.activeUsers, color: '#16a34a' }, { name: 'Inactive', value: stats.inactiveUsers, color: '#94a3b8' }]
  return <>
    <SectionHeading eyebrow="ADMINISTRATION" title="University overview" description="Live totals from your university database." action="Manage faculties" onAction={() => navigate('/app/faculties')} />
    <div className="metrics-grid metrics-four">
      <MetricCard label="Students" value={stats.students} note="All accounts" icon={UsersRound} tone="blue" />
      <MetricCard label="Teachers" value={stats.teachers} note="All accounts" icon={GraduationCap} tone="green" />
      <MetricCard label="Faculties" value={stats.faculties} note="Academic units" icon={Building2} tone="violet" />
      <MetricCard label="Departments" value={stats.departments} note="Academic units" icon={Building2} tone="amber" />
      <MetricCard label="Classes" value={stats.classes} note="Academic groups" icon={LibraryBig} tone="blue" />
      <MetricCard label="Active users" value={stats.activeUsers} note="Can sign in" icon={CheckCircle2} tone="green" />
      <MetricCard label="Inactive users" value={stats.inactiveUsers} note="Access disabled" icon={ShieldCheck} tone="rose" />
    </div>
    <div className="dashboard-grid admin-dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Account distribution</h2><p>People and account access status</p></div><UsersRound size={18} className="panel-heading-icon" /></div>{stats.activeUsers + stats.inactiveUsers ? <div className="admin-chart-grid">{[[roleChart, stats.students + stats.teachers, 'people'], [statusChart, stats.activeUsers + stats.inactiveUsers, 'accounts']].map(([chart, total, label]) => <div className="admin-chart" key={label}><ResponsiveContainer width="48%" height={160}><PieChart><Pie data={chart} dataKey="value" nameKey="name" innerRadius={44} outerRadius={62} paddingAngle={5} stroke="none">{chart.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="chart-legend"><div className="chart-total">{total}<small>{label}</small></div>{chart.map((entry) => <div className="legend-row" key={entry.name}><i style={{ background: entry.color }} />{entry.name}<b>{entry.value}</b></div>)}</div></div>)}</div> : <EmptyState title="No users yet" description="Teacher and student accounts will appear here." />}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Recent registrations</h2><p>Newest teacher and student accounts</p></div><button className="link-button" onClick={() => navigate('/app/students')}>Manage users <ArrowRight size={14} /></button></div>{data.recentUsers.length ? <div className="compact-user-list">{data.recentUsers.map((person) => <div className="compact-user" key={person._id}><ProfileAvatar user={person} size="small" /><span className="compact-user-info"><b>{person.fullName}</b><small>{person.email}</small></span><span className={`role-pill role-${person.role}`}>{person.role}</span><span className={`status-pill ${person.isActive ? 'status-complete' : 'status-inactive'}`}>{person.isActive ? 'Active' : 'Inactive'}</span></div>)}</div> : <EmptyState title="No accounts to show" description="Students and teachers will appear here when accounts are created." />}</section></div>
  </>
}

function TeacherDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const load = () => api.get('/teacher/dashboard').then(({ data: result }) => { setData(result); setError('') }).catch((e) => setError(e.response?.data?.message || 'Could not load your dashboard'))
  useEffect(() => { load() }, [])
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <PageLoading />
  const m = data.metrics
  return <><SectionHeading eyebrow="TEACHING WORKSPACE" title={`Welcome back, ${user?.fullName || 'Teacher'}`} description="Live class and learning content totals for your assigned teaching groups." action="Open my classes" onAction={() => navigate('/app/classes')} />
    <div className="metrics-grid metrics-four"><MetricCard label="Assigned classes" value={m.classes} note="Active groups" icon={LibraryBig} tone="blue" /><MetricCard label="Students" value={m.students} note="Across assigned classes" icon={UsersRound} tone="green" /><MetricCard label="Lessons created" value={m.lessons} note="Created by you" icon={BookOpenCheck} tone="violet" /><MetricCard label="Published lessons" value={m.publishedLessons} note="Available to students" icon={CheckCircle2} tone="amber" /></div>
    <div className="dashboard-grid"><section className="panel wide-panel"><div className="panel-heading"><div><h2>Your classes</h2><p>Teaching groups assigned to your account</p></div><button className="link-button" onClick={() => navigate('/app/classes')}>Manage classes <ArrowRight size={14} /></button></div>{data.classes.length ? <div className="class-card-grid">{data.classes.map((item, index) => <button className="class-card" key={item._id} onClick={() => navigate(`/app/classes/${item._id}`)}><span className={`class-card-icon ${toneCycle[index % toneCycle.length]}`}><LibraryBig size={19} /></span><span className="class-card-copy"><b>{item.name}</b><small>{item.classCode} · {item.studentsCount} students</small></span><ArrowRight size={16} /></button>)}</div> : <EmptyState title="No classes assigned" description="Ask an administrator to assign classes to your teacher account." />}</section><section className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Continue your teaching work</p></div></div><button className="quick-action" onClick={() => navigate('/app/courses')}><span className="quick-action-icon blue"><BookOpenCheck size={17} /></span><span><b>Choose a course</b><small>Create a lesson for one of your courses</small></span><ArrowRight size={15} /></button><button className="quick-action" onClick={() => navigate('/app/assignments')}><span className="quick-action-icon amber"><ClipboardCheck size={17} /></span><span><b>Review submissions</b><small>Open assignment feedback</small></span><ArrowRight size={15} /></button><button className="quick-action" onClick={() => navigate('/app/quizzes')}><span className="quick-action-icon violet"><CalendarDays size={17} /></span><span><b>Open quizzes</b><small>Manage existing assessments</small></span><ArrowRight size={15} /></button></section></div>
    <section className="panel teacher-recent-panel"><div className="panel-heading"><div><h2>Recent lessons</h2><p>Your latest learning content updates</p></div><button className="link-button" onClick={() => navigate('/app/courses')}>All lessons <ArrowRight size={14} /></button></div>{data.recentLessons.length ? <div className="lesson-mini-list">{data.recentLessons.map((lesson) => <button key={lesson._id} onClick={() => navigate('/app/courses')}><BookOpenCheck size={16} /><span><b>{lesson.title}</b><small>{lesson.class?.classCode} · {lesson.status || (lesson.isPublished ? 'published' : 'draft')}</small></span><span className="status-pill">{lesson.status || (lesson.isPublished ? 'Published' : 'Draft')}</span></button>)}</div> : <EmptyState title="No lessons yet" description="Choose a course to create your first lesson." icon={BookOpenCheck} />}</section>
  </>
}

function StudentDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const load = () => Promise.all([api.get('/student/overview'), api.get('/student/courses')]).then(([overview, courses]) => { setData({ ...overview.data, courses: courses.data.courses || [], currentCourses: courses.data.currentCourses || courses.data.courses || [], previousCourses: courses.data.previousCourses || [], upcomingCourses: courses.data.upcomingCourses || [], currentAcademicYear: courses.data.currentAcademicYear || '' }); setError('') }).catch((e) => setError(e.response?.data?.message || 'Could not load your dashboard'))
  useEffect(() => { load() }, [])
  const submitted = useMemo(() => new Set((data?.submissions || []).map((item) => String(item.assignment?._id || item.assignment))), [data])
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <PageLoading />
  const pending = data.assignments.filter((item) => !submitted.has(String(item._id))).length
  const graded = data.submissions.filter((item) => item.score !== null || item.marksAwarded != null).length
  const submittedAssignments = data.assignments.filter((item) => submitted.has(String(item._id))).length
  const assignmentStatus = [
    { name: 'Submitted', value: submittedAssignments, color: 'var(--green)' },
    { name: 'To do', value: pending, color: '#f1b64c' },
  ].filter((item) => item.value > 0)
  const assignmentById = new Map(data.assignments.map((item) => [String(item._id), item]))
  const gradeResults = data.submissions
    .filter((item) => item.score != null || item.marksAwarded != null)
    .map((item) => {
      const assignment = item.assignment && typeof item.assignment === 'object' ? item.assignment : assignmentById.get(String(item.assignment))
      const marks = item.marksAwarded ?? item.score
      const total = assignment?.totalMarks ?? assignment?.maxScore
      if (!assignment || !total) return null
      return { title: assignment.title, score: Math.round((Number(marks) / Number(total)) * 100), submittedAt: item.submittedAt }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .slice(-5)
    .map((item) => ({ ...item, label: item.title.length > 14 ? `${item.title.slice(0, 13)}…` : item.title }))
  return <><SectionHeading eyebrow="STUDENT WORKSPACE" title="Your learning overview" description="Pick up where you left off and stay on top of what’s due." action="Open my courses" onAction={() => navigate('/app/learning')} />
    <div className="student-class-banner"><div className="class-banner-symbol"><GraduationCap size={22} /></div><div><span>YOUR ACADEMIC CLASS</span><h2>{data.class?.name || 'Class not assigned'}</h2><p>{data.class?.classCode || 'Contact your administrator if this looks incorrect'}{data.class?.department?.name ? ` · ${data.class.department.name}` : ''}</p></div><button className="banner-action" onClick={() => navigate('/app/learning')}>View class <ArrowRight size={15} /></button></div>
    <div className="metrics-grid metrics-four"><MetricCard label="Courses" value={data.courses.length} note="Enrolled courses" icon={BookOpenCheck} tone="blue" /><MetricCard label="Upcoming work" value={pending} note="Assignments to submit" icon={ClipboardCheck} tone="amber" /><MetricCard label="Quizzes" value={data.quizzes.length} note="Available to take" icon={CalendarDays} tone="violet" /><MetricCard label="Feedback received" value={graded} note="Graded submissions" icon={CheckCircle2} tone="green" /></div>
    <div className="student-charts-grid">
      <section className="panel student-chart-panel"><div className="panel-heading"><div><h2>Assignment progress</h2><p>Your submitted work and what is still ahead</p></div><ClipboardCheck size={18} className="panel-heading-icon" /></div>{data.assignments.length ? <div className="student-progress-chart"><div className="student-donut-wrap"><ResponsiveContainer width="100%" height={190}><PieChart><Pie data={assignmentStatus} dataKey="value" nameKey="name" innerRadius={57} outerRadius={77} paddingAngle={5} stroke="none">{assignmentStatus.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip formatter={(value, name) => [`${value} assignments`, name]} /></PieChart></ResponsiveContainer><div className="student-donut-center"><b>{submittedAssignments}/{data.assignments.length}</b><span>submitted</span></div></div><div className="student-chart-legend">{[{ name: 'Submitted', value: submittedAssignments, color: 'var(--green)' }, { name: 'To do', value: pending, color: '#f1b64c' }].map((item) => <div className="student-legend-row" key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><b>{item.value}</b></div>)}<small>From your upcoming assignments</small></div></div> : <EmptyState title="No assignments yet" description="Your progress chart will appear when assignments are published." />}</section>
      <section className="panel student-chart-panel"><div className="panel-heading"><div><h2>Recent results</h2><p>Scores from your latest graded assignments</p></div><CheckCircle2 size={18} className="panel-heading-icon" /></div>{gradeResults.length ? <div className="student-score-chart"><ResponsiveContainer width="100%" height={218}><BarChart data={gradeResults} margin={{ top: 8, right: 8, left: -22, bottom: 2 }}><CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" /><XAxis dataKey="label" tick={{ fill: '#8290a4', fontSize: 9 }} axisLine={false} tickLine={false} interval={0} /><YAxis domain={[0, 100]} tick={{ fill: '#8290a4', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value) => [`${value}%`, 'Score']} labelFormatter={(label) => gradeResults.find((item) => item.label === label)?.title || label} cursor={{ fill: 'var(--blue-soft)' }} /><Bar dataKey="score" fill="var(--blue)" radius={[6, 6, 0, 0]} maxBarSize={34} /></BarChart></ResponsiveContainer><div className="student-chart-caption">Showing up to 5 recent graded assignments</div></div> : <EmptyState title="No graded results yet" description="Your scores will appear here after your assignments are graded." />}</section>
    </div>
    <StudentWeeklyLearning />
    <DashboardNotesWidget />
    <div className="dashboard-grid"><section className="panel wide-panel"><div className="panel-heading"><div><h2>Coming up</h2><p>Assignments for your class</p></div><button className="link-button" onClick={() => navigate('/app/assignments')}>All assignments <ArrowRight size={14} /></button></div>{data.assignments.length ? <div className="upcoming-list">{data.assignments.slice(0, 5).map((assignment) => <div className="upcoming-item" key={assignment._id}><span className="upcoming-icon"><ClipboardCheck size={18} /></span><span className="upcoming-copy"><b>{assignment.title}</b><small>Due {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(assignment.dueDate))}</small></span><span className={`status-pill ${submitted.has(String(assignment._id)) ? 'status-complete' : 'status-pending'}`}>{submitted.has(String(assignment._id)) ? 'Submitted' : 'To do'}</span></div>)}</div> : <EmptyState title="Nothing due yet" description="New assignments from your teachers will appear here." />}</section><section className="panel"><div className="panel-heading"><div><h2>My courses</h2><p>{data.currentAcademicYear ? `Current academic year · ${data.currentAcademicYear}` : 'Current and previous courses'}</p></div><button className="link-button" onClick={() => navigate('/app/learning')}>View all <ArrowRight size={14} /></button></div><div className="student-dashboard-course-group"><b>Currently taking</b>{data.currentCourses.length ? <div className="lesson-mini-list">{data.currentCourses.slice(0, 3).map((course) => <button key={course._id} onClick={() => navigate(`/app/learning/courses/${course._id}`)}><BookOpenCheck size={16} /><span><b>{course.name}</b><small>{course.courseCode} · {course.academicYear || data.currentAcademicYear || 'Current'}</small></span><ArrowRight size={14} /></button>)}</div> : <small>No current courses.</small>}</div><div className="student-dashboard-course-group"><b>Upcoming courses</b>{data.upcomingCourses.length ? <div className="lesson-mini-list">{data.upcomingCourses.slice(0, 2).map((course) => <button key={course._id} onClick={() => navigate(`/app/learning/courses/${course._id}`)}><BookOpenCheck size={16} /><span><b>{course.name}</b><small>{course.courseCode} · {course.academicYear}</small></span><ArrowRight size={14} /></button>)}</div> : <small>No upcoming courses.</small>}</div><div className="student-dashboard-course-group"><b>Previously taken</b>{data.previousCourses.length ? <div className="lesson-mini-list">{data.previousCourses.slice(0, 3).map((course) => <button key={course._id} onClick={() => navigate(`/app/learning/courses/${course._id}`)}><BookOpenCheck size={16} /><span><b>{course.name}</b><small>{course.courseCode} · {course.academicYear || 'Previous year'}</small></span><ArrowRight size={14} /></button>)}</div> : <small>No previous courses.</small>}</div></section></div>
  </>
}

export default function DashboardPage() {
  const { user } = useAuth()
  if (user.role === 'admin') return <AdminDashboard />
  if (user.role === 'teacher') return <TeacherDashboard />
  return <StudentDashboard />
}
