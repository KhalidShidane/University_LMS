import { useEffect, useState } from 'react'
import { ArrowRight, BookOpenCheck, GraduationCap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './TeacherCoursesPage.css'

export default function TeacherCoursesPage() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/teacher/courses')
      setCourses(data.courses || [])
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return <div className="teacher-courses-page">
    <div className="section-title-row"><div><div className="section-kicker">TEACHING WORKSPACE</div><h1>My courses</h1><p>Courses assigned to you by your administrator.</p></div><span className="toolbar-note">{courses.length} {courses.length === 1 ? 'course' : 'courses'}</span></div>
    {courses.length ? <div className="teacher-course-grid">{courses.map((course) => <article className="panel teacher-course-card" key={`${course._id}-${course.assignmentClassId || course.class?._id || ''}`}>
      
      <div className="teacher-course-body"><span className="section-kicker">{course.courseCode}</span><h2>{course.name}</h2><p>{course.description || course.class?.name || 'Assigned course'}</p><div className="content-card-meta"><span><GraduationCap size={14} /> {course.class?.classCode || course.class?.name || 'Class'}</span><span>{course.lessonCount || 0} lessons</span></div><button className="button-primary" onClick={() => navigate(`/app/lessons?courseId=${course._id}&classId=${course.assignmentClassId || course.class?._id || course.class}`)}><BookOpenCheck size={15} /> Add lesson <ArrowRight size={14} /></button></div>
    </article>)}</div> : <EmptyState title="No courses assigned" description="Courses assigned to you by your administrator will appear here." icon={BookOpenCheck} />}
  </div>
}
