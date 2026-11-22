import { useEffect, useState } from 'react'
import { ArrowRight, BookOpenCheck, Filter, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './StudentLessonsPage.css'
import '../StudentCourseGroups.css'

export default function StudentLessonsPage() {
  const [courses, setCourses] = useState([])
  const [currentAcademicYear, setCurrentAcademicYear] = useState('')
  const [search, setSearch] = useState('')
  const [courseFilter, setCourseFilter] = useState('period:current')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() {
    setLoading(true); setError('')
    try { const { data } = await api.get('/student/courses'); setCourses(data.courses || []); setCurrentAcademicYear(data.currentAcademicYear || '') }
    catch (requestError) { setError(apiErrorMessage(requestError)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const filtered = courses.filter((course) => {
    const matchesSearch = `${course.name} ${course.courseCode} ${course.class?.classCode || ''}`.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = courseFilter === 'all'
      || courseFilter === `period:${course.coursePeriod}`
    return matchesSearch && matchesFilter
  })
  const groups = [
    { title: 'Currently taking', year: currentAcademicYear, courses: filtered.filter((course) => course.coursePeriod === 'current') },
    { title: 'Upcoming', year: '', courses: filtered.filter((course) => course.coursePeriod === 'upcoming') },
    { title: 'Previously taken', year: '', courses: filtered.filter((course) => course.coursePeriod === 'previous') },
  ]
  const visibleGroups = groups.filter((group) => group.courses.length > 0)
  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />
  return <div className="student-lessons-page"><div className="section-title-row"><div><div className="section-kicker">YOUR LEARNING</div><h1>My courses</h1><p>Courses are grouped by academic year.</p></div></div><div className="management-toolbar lesson-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search courses" placeholder="Search courses" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="course-filter-control"><Filter size={15} /><select aria-label="Filter courses by academic status" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All courses</option><option value="period:current">Currently taking</option><option value="period:upcoming">Upcoming</option><option value="period:previous">Previously taken</option></select></label><span className="toolbar-note">{filtered.length} {filtered.length === 1 ? 'course' : 'courses'}</span></div>{visibleGroups.map((group) => <section className="student-course-year-group" key={group.title}><div className="student-course-year-heading"><h2>{group.title}</h2>{group.year && <span>{group.year}</span>}</div><div className="lesson-management-grid student-lesson-grid">{group.courses.map((course, index) => <Link className="panel student-lesson-card" key={course._id} to={`/app/learning/courses/${course._id}`}><div className="lesson-cover gradient-cover" aria-hidden="true"><BookOpenCheck size={34} strokeWidth={1.6} /><span className="gradient-cover-label">{course.courseCode || `COURSE ${String(index + 1).padStart(2, '0')}`}</span></div><div className="lesson-management-body"><small className="section-kicker">{[course.academicYear || group.year, course.semester].filter(Boolean).join(' · ') || `COURSE ${String(index + 1).padStart(2, '0')}`}</small><h2>{course.name}</h2><p>{course.description || course.class?.name || 'Course lessons and learning materials.'}</p><div className="content-card-meta"><span>{course.teacher?.fullName || 'Instructor not assigned'}</span><span>{course.lessonCount || 0} lessons <ArrowRight size={14} /></span></div></div></Link>)}</div></section>)}{!filtered.length && <p className="student-course-year-empty">No courses match this filter.</p>}</div>
}
