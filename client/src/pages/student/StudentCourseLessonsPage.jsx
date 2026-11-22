import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpenCheck, FolderDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { saveBlob } from '../../utils/download.js'
import { Link, useParams } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './StudentLessonsPage.css'

export default function StudentCourseLessonsPage() {
  const { courseId } = useParams()
  const [course, setCourse] = useState(null)
  const [lessons, setLessons] = useState([])
  const [error, setError] = useState('')
  async function load() {
    setError('')
    try { const { data } = await api.get(`/student/courses/${courseId}/lessons`); setCourse(data.course); setLessons(data.lessons || []) }
    catch (requestError) { setError(apiErrorMessage(requestError)) }
  }
  useEffect(() => { load() }, [courseId])
  if (error && !course) return <ErrorState message={error} onRetry={load} />
  if (!course) return <PageLoading />
  return <div className="student-lessons-page"><div className="section-title-row"><div><div className="section-kicker">{course.courseCode}</div><h1>{course.name}</h1><p>{course.class?.name || 'Course lessons shared by your instructor.'}</p></div><div className="section-title-actions"><DownloadAllMaterials courseId={courseId} hasMaterials={lessons.some((lesson) => lesson.materials?.length)} /><Link className="button-secondary" to="/app/learning"><ArrowLeft size={15} /> My courses</Link></div></div>{error && <p role="alert" className="inline-error">{error}</p>}{lessons.length ? <div className="lesson-management-grid student-lesson-grid">{lessons.map((lesson, index) => <Link className="panel student-lesson-card" key={lesson._id} to={`/app/learning/courses/${courseId}/lessons/${lesson._id}`}><div className="lesson-cover gradient-cover" aria-hidden="true"><BookOpenCheck size={34} strokeWidth={1.6} /><span className="gradient-cover-number">{String(index + 1).padStart(2, '0')}</span></div><div className="lesson-management-body"><small className="section-kicker">LESSON {String(index + 1).padStart(2, '0')} {lesson.subject ? ` · ${lesson.subject}` : ''}</small><h2>{lesson.title}</h2><p>{lesson.summary || lesson.content?.slice(0, 150) || 'Open this lesson to read the learning content.'}</p><div className="content-card-meta"><span>{lesson.createdBy?.fullName || 'Your instructor'}</span><span>Read lesson <ArrowRight size={14} /></span></div></div></Link>)}</div> : <EmptyState title="No lessons published" description="Published lessons for this course will appear here." icon={BookOpenCheck} />}</div>
}

function DownloadAllMaterials({ courseId, hasMaterials }) {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    const pending = toast.loading('Preparing your ZIP file…')
    try {
      const response = await api.get(`/student/courses/${courseId}/materials/download`, { responseType: 'blob' })
      saveBlob(response, 'course-materials.zip')
      toast.success('Download started', { id: pending })
    } catch (error) {
      let message = apiErrorMessage(error)
      try { const text = await error.response?.data?.text?.(); if (text) message = JSON.parse(text).message || message } catch { /* keep message */ }
      toast.error(message, { id: pending })
    } finally {
      setBusy(false)
    }
  }
  return <button type="button" className="button-primary" onClick={download} disabled={busy || !hasMaterials} title={hasMaterials ? 'Download every lesson file in this course as one ZIP' : 'No materials in this course yet'}><FolderDown size={16} />{busy ? 'Preparing…' : 'Download all materials (ZIP)'}</button>
}
