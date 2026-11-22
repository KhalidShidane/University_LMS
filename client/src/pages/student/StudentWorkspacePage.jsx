import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowRight, BookOpenCheck, CheckCircle2, ClipboardCheck, Clock3, FileUp, LibraryBig, Play, Timer } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'

const dateLabel = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export default function StudentWorkspacePage({ section = 'learning' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [submittingQuiz, setSubmittingQuiz] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const endpoint = section === 'assignments' ? '/student/assignments' : section === 'quizzes' ? '/student/quizzes' : '/student/overview'
      const { data: result } = await api.get(endpoint)
      setData(result)
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [section])
  useEffect(() => {
    if (!activeQuiz) return undefined
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((new Date(activeQuiz.attempt.endsAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(remaining)
    }
    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [activeQuiz])

  async function uploadSubmission(assignmentId, file) {
    if (!file) return
    if (!/\.(pdf|doc|docx|ppt|pptx)$/i.test(file.name)) {
      toast.error('Choose a PDF, Word, or PowerPoint document')
      return
    }
    const body = new FormData()
    body.append('file', file)
    setUploading(assignmentId)
    try {
      await api.post(`/student/assignments/${assignmentId}/submission`, body)
      toast.success('Assignment submitted')
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setUploading('')
    }
  }

  async function startQuiz(quiz) {
    try {
      const { data: result } = await api.post(`/student/quizzes/${quiz._id}/start`)
      setActiveQuiz({ ...result.quiz, attempt: result.attempt })
      setAnswers({})
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
      load()
    }
  }

  async function submitQuiz() {
    if (!activeQuiz || submittingQuiz) return
    setSubmittingQuiz(true)
    try {
      const submitted = await api.post(`/student/quiz-attempts/${activeQuiz.attempt._id}/submit`, {
        answers: Object.entries(answers).map(([questionId, selectedOption]) => ({ questionId, selectedOption })),
      })
      toast.success(`Quiz submitted · ${submitted.data.attempt.score} / ${submitted.data.attempt.maxScore}`)
      setActiveQuiz(null)
      await load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
      if (requestError.response?.status === 409) setActiveQuiz(null)
    } finally {
      setSubmittingQuiz(false)
    }
  }

  async function downloadSubmission(submission) {
    try {
      const { data: blob } = await api.get(`/student/submissions/${submission._id}/file`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = submission.originalName || 'submission.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not download your submission')
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <PageLoading />

  if (section === 'learning') return <>
    <div className="section-title-row"><div><div className="section-kicker">YOUR CLASSROOM</div><h1>My class</h1><p>Learning materials shared by your teachers.</p></div></div>
    <section className="student-class-banner learning-banner"><div className="class-banner-symbol"><LibraryBig size={22} /></div><div><span>{data.class?.classCode || 'ACADEMIC CLASS'}</span><h2>{data.class?.name || 'No class assigned'}</h2><p>{data.class?.department?.name || 'Your class lessons appear below'}</p></div></section>
    <div className="student-content-grid">{data.lessons.length ? data.lessons.map((lesson, index) => <article className="lesson-card" key={lesson._id}><div className="lesson-card-top"><span className="lesson-count">LESSON {String(index + 1).padStart(2, '0')}</span><BookOpenCheck size={18} /></div><h2>{lesson.title}</h2>{lesson.summary && <p className="lesson-summary">{lesson.summary}</p>}<div className="lesson-body">{lesson.content}</div><div className="content-card-meta"><span>{lesson.createdBy?.fullName || 'Your teacher'}</span><span>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(lesson.createdAt))}</span></div></article>) : <EmptyState title="No lessons shared yet" description="Your teacher’s published lessons will be available here." icon={BookOpenCheck} />}</div>
  </>

  if (section === 'assignments') return <>
      <div className="section-title-row"><div><div className="section-kicker">YOUR COURSEWORK</div><h1>Assignments</h1><p>Upload PDF, Word, or PowerPoint submissions and review feedback from your teachers.</p></div></div>
    <div className="student-assignment-list">{data.assignments.length ? data.assignments.map((item) => <article className="panel student-assignment" key={item._id}><div className="student-assignment-top"><span className="content-card-icon assignment-color"><ClipboardCheck size={19} /></span><div className="student-assignment-info"><div className="content-card-title"><h2>{item.title}</h2><span className={`status-pill ${item.submission ? item.submission.score !== null ? 'status-complete' : 'status-pending' : new Date(item.dueDate) < new Date() ? 'status-late' : 'status-pending'}`}>{item.submission ? item.submission.score !== null ? 'Graded' : item.submission.status : new Date(item.dueDate) < new Date() ? 'Overdue' : 'To do'}</span></div><p>{item.instructions}</p><div className="content-card-meta"><span><Clock3 size={13} /> Due {dateLabel(item.dueDate)}</span><span>Max score {item.maxScore}</span></div></div></div>{item.submission && <div className="submission-feedback"><div className="feedback-heading"><CheckCircle2 size={15} /><b>{item.submission.score !== null ? `Score: ${item.submission.score} / ${item.maxScore}` : 'Submission received'}</b><span>{dateLabel(item.submission.submittedAt)}</span><button className="icon-button" onClick={() => downloadSubmission(item.submission)} title="Download your submission"><ArrowDownToLine size={16} /></button></div>{item.submission.feedback && <p>{item.submission.feedback}</p>}</div>}<div className="upload-row"><label className="upload-control"><FileUp size={16} /><span>{uploading === item._id ? 'Uploading…' : item.submission ? 'Replace submission' : 'Upload submission'}</span><input type="file" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx" disabled={uploading === item._id} onChange={(e) => { uploadSubmission(item._id, e.target.files?.[0]); e.target.value = '' }} /></label><span className="upload-limit">PDF · up to 10 MB</span></div></article>) : <EmptyState title="No assignments available" description="Published assignments from your teacher will appear here." icon={ClipboardCheck} />}</div>
  </>

  return <>
    <div className="section-title-row"><div><div className="section-kicker">CHECK YOUR UNDERSTANDING</div><h1>Quizzes</h1><p>Take timed quizzes and see your results when you submit.</p></div></div>
    <div className="quiz-list">{data.quizzes.length ? data.quizzes.map((quiz) => <article className="panel quiz-list-item" key={quiz._id}><span className="content-card-icon quiz-color"><Timer size={19} /></span><div className="quiz-list-main"><div className="content-card-title"><h2>{quiz.title}</h2>{quiz.attempt?.status === 'submitted' && <span className="status-pill status-complete">{quiz.attempt.score} points</span>}{quiz.attempt?.status === 'expired' && <span className="status-pill status-late">Expired</span>}</div><p>{quiz.instructions || 'Timed assessment'}</p><div className="content-card-meta"><span>{quiz.questions.length} questions</span><span>{quiz.durationMinutes} minutes</span><span>Available {dateLabel(quiz.availableFrom)}</span></div></div>{quiz.attempt?.status === 'in-progress' ? <button className="button-primary" onClick={() => startQuiz(quiz)}>Continue <ArrowRight size={15} /></button> : <button className="button-secondary" onClick={() => startQuiz(quiz)} disabled={Boolean(quiz.attempt && quiz.attempt.status !== 'in-progress')}>{quiz.attempt ? 'Attempt complete' : 'Start quiz'}<Play size={14} /></button>}</article>) : <EmptyState title="No quizzes available" description="Published quizzes for your class will appear here." icon={Timer} />}</div>
    {activeQuiz && <div className="modal-backdrop" role="presentation"><section className="quiz-modal" role="dialog" aria-modal="true" aria-labelledby="quiz-title"><div className="quiz-modal-head"><div><span className="section-kicker">TIMED ASSESSMENT</span><h2 id="quiz-title">{activeQuiz.title}</h2></div><span className={`timer-pill ${secondsLeft < 60 ? 'timer-warning' : ''}`}><Timer size={16} />{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span></div>{activeQuiz.instructions && <p className="quiz-instructions">{activeQuiz.instructions}</p>}<div className="quiz-question-list">{activeQuiz.questions.map((question, index) => <fieldset className="quiz-question" key={question.id}><legend><span>{index + 1}</span>{question.prompt}<small>{question.points} pt</small></legend>{question.options.map((option, optionIndex) => <label className={`quiz-option ${answers[question.id] === optionIndex ? 'quiz-option-selected' : ''}`} key={optionIndex}><input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((state) => ({ ...state, [question.id]: optionIndex }))} />{option}</label>)}</fieldset>)}</div><div className="quiz-modal-footer"><span>{Object.keys(answers).length} of {activeQuiz.questions.length} answered</span><button className="button-primary" onClick={submitQuiz} disabled={submittingQuiz}>{submittingQuiz ? 'Submitting…' : 'Submit quiz'}<ArrowRight size={15} /></button></div></section></div>}
  </>
}
