import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Clock3, Eye, FileQuestion, Lock, Play, RotateCcw, Send, Timer, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './StudentQuizzesPage.css'

const formatDate = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'No end time'
const answersFromAttempt = (attempt) => Object.fromEntries((attempt.answers || []).map((answer) => [answer.questionId, answer.selectedOption ?? answer.textAnswer ?? '']))

export default function StudentQuizzesPage() {
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState(null)
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [timerReady, setTimerReady] = useState(false)
  const [savingState, setSavingState] = useState('saved')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [review, setReview] = useState(null)
  const [serverOffset, setServerOffset] = useState(0)
  const saveTimer = useRef(null)
  const submitLock = useRef(false)

  async function load({ resume = true } = {}) {
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/student/quizzes')
      setQuizzes(data.quizzes)
      if (resume && !activeQuiz) {
        const current = data.quizzes.find((quiz) => quiz.attempt?.status === 'in_progress')
        if (current) await openAttempt(current)
      }
    } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!activeQuiz) return undefined
    setTimerReady(false)
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(activeQuiz.attempt.expiresAt).getTime() - (Date.now() + serverOffset)) / 1000)))
    update()
    setTimerReady(true)
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [activeQuiz, serverOffset])

  function openAttemptPayload(data) {
    setActiveQuiz({ ...data.quiz, attempt: data.attempt })
    setAnswers(answersFromAttempt(data.attempt))
    setQuestionIndex(0)
    setServerOffset(new Date(data.serverNow).getTime() - Date.now())
    setSavingState('saved')
    setDetails(null)
    setResult(null)
  }

  async function openAttempt(quiz) {
    try {
      let response
      if (quiz.attempt?.status === 'in_progress') response = await api.get(`/student/quizzes/${quiz._id}/attempt`)
      else response = await api.post(`/student/quizzes/${quiz._id}/start`)
      if (response.data.attempt.status !== 'in_progress') {
        toast('This attempt has ended. Check your attempt history for its status.')
        await load({ resume: false })
        return
      }
      openAttemptPayload(response.data)
    } catch (e) { toast.error(apiErrorMessage(e)); await load({ resume: false }) }
  }

  async function viewDetails(quiz) {
    try { const { data } = await api.get(`/student/quizzes/${quiz._id}`); setDetails(data.quiz) } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  const answerPayload = () => activeQuiz.questions.flatMap((question) => {
    const value = answers[question.id]
    if (question.questionType === 'short_answer') return [{ questionId: question.id, textAnswer: value || '' }]
    return Number.isInteger(value) ? [{ questionId: question.id, selectedOption: value }] : []
  })

  async function saveAnswers() {
    if (!activeQuiz || !['in_progress', 'in-progress'].includes(activeQuiz.attempt.status)) return
    setSavingState('saving')
    try {
      const { data } = await api.put(`/student/attempts/${activeQuiz.attempt.id}/answers`, { answers: answerPayload() })
      setActiveQuiz((current) => current ? { ...current, attempt: data.attempt } : current)
      setServerOffset(new Date(data.serverNow).getTime() - Date.now())
      setSavingState('saved')
    } catch (e) { setSavingState('error'); toast.error(apiErrorMessage(e)) }
  }

  useEffect(() => {
    if (!activeQuiz || !['in_progress', 'in-progress'].includes(activeQuiz.attempt.status)) return undefined
    setSavingState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveAnswers() }, 450)
    return () => clearTimeout(saveTimer.current)
  }, [answers])

  useEffect(() => {
    const reconnect = () => { if (navigator.onLine) saveAnswers() }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [activeQuiz, answers])

  async function submitAttempt(automatic = false) {
    if (!activeQuiz || submitting || submitLock.current) return
    if (!automatic && !window.confirm('Submit your quiz now? You will not be able to change your answers.')) return
    submitLock.current = true; setSubmitting(true)
    try {
      clearTimeout(saveTimer.current)
      await saveAnswers()
      const { data } = await api.post(`/student/attempts/${activeQuiz.attempt.id}/submit`)
      toast.success(automatic ? 'Time is up. Your quiz has been submitted.' : 'Quiz submitted successfully.')
      setActiveQuiz(null); setAnswers({}); await load({ resume: false })
      await openReview(data.attempt.id)
    } catch (e) {
      toast.error(apiErrorMessage(e))
      if (e.response?.status === 409) { setActiveQuiz(null); await load({ resume: false }) }
    } finally { submitLock.current = false; setSubmitting(false) }
  }

  useEffect(() => {
    if (timerReady && activeQuiz && secondsLeft === 0 && activeQuiz.attempt.status === 'in_progress' && !submitLock.current) submitAttempt(true)
  }, [secondsLeft, activeQuiz, timerReady])

  async function openReview(attemptId) {
    try { const { data } = await api.get(`/student/attempts/${attemptId}/review`); setResult(null); setReview(data) } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function openResult(attemptId) {
    try { const { data } = await api.get(`/student/attempts/${attemptId}/result`); setResult(data) } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  if (loading && !quizzes.length) return <PageLoading />
  if (error && !quizzes.length) return <ErrorState message={error} onRetry={() => load()} />

  const currentQuestion = activeQuiz?.questions[questionIndex]
    const answeredCount = activeQuiz ? activeQuiz.questions.filter((question) => question.questionType === 'short_answer' ? Boolean(String(answers[question.id] || '').trim()) : Number.isInteger(answers[question.id])).length : 0

  if (activeQuiz && currentQuestion) return <div className="student-active-quiz">
    <header className="active-quiz-header"><button className="button-quiet" onClick={() => { if (window.confirm('Leave the quiz? Your saved answers will be available when you return.')) { setActiveQuiz(null); load({ resume: false }) } }}><ArrowLeft size={15} /> Exit quiz</button><div><span className="section-kicker">TIMED ASSESSMENT</span><h1>{activeQuiz.title}</h1></div><div className={`active-quiz-timer ${secondsLeft < 60 ? 'active-quiz-timer-warning' : ''}`}><Timer size={17} /><span>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span></div></header>
    <div className="active-quiz-progress"><span>{answeredCount} of {activeQuiz.questions.length} answered</span><span>{savingState === 'saving' ? 'Saving answers…' : savingState === 'error' ? 'Could not save · check connection' : 'All answers saved'}</span><div><i style={{ width: `${(answeredCount / activeQuiz.questions.length) * 100}%` }} /></div></div>
    <div className="active-quiz-layout"><aside className="panel question-navigation"><b>Questions</b><div>{activeQuiz.questions.map((question, index) => <button key={question.id} className={`${index === questionIndex ? 'question-nav-current' : ''} ${question.questionType === 'short_answer' ? Boolean(String(answers[question.id] || '').trim()) : Number.isInteger(answers[question.id]) ? 'question-nav-answered' : ''}`} onClick={() => setQuestionIndex(index)} aria-label={`Question ${index + 1}`}><span>{Number.isInteger(answers[question.id]) || Boolean(String(answers[question.id] || '').trim()) ? <Check size={14} /> : index + 1}</span></button>)}</div><small>{activeQuiz.questions.length} questions · {activeQuiz.totalMarks} marks</small></aside>
      <section className="panel active-question-panel"><div className="active-question-kicker"><span>QUESTION {String(questionIndex + 1).padStart(2, '0')} / {String(activeQuiz.questions.length).padStart(2, '0')}</span><span>{currentQuestion.marks} marks</span></div><h2>{currentQuestion.questionText}</h2>{currentQuestion.questionType === 'short_answer' ? <label className="active-short-answer">Your answer<textarea rows="7" maxLength="10000" placeholder="Write your answer here…" value={answers[currentQuestion.id] || ''} onChange={(e) => setAnswers((state) => ({ ...state, [currentQuestion.id]: e.target.value }))} /></label> : <div className="active-quiz-options">{currentQuestion.options.map((option, index) => <label key={index} className={answers[currentQuestion.id] === index ? 'active-quiz-option-selected' : ''}><input type="radio" name={currentQuestion.id} checked={answers[currentQuestion.id] === index} onChange={() => setAnswers((state) => ({ ...state, [currentQuestion.id]: index }))} /><span className="active-option-marker">{answers[currentQuestion.id] === index ? <Check size={14} /> : <Circle size={14} />}</span>{option}</label>)}</div>}<div className="active-question-footer"><button className="button-secondary" onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))} disabled={questionIndex === 0}><ArrowLeft size={15} /> Previous</button><span>{savingState === 'saving' ? 'Saving…' : savingState === 'error' ? 'Not saved' : 'Saved'}</span>{questionIndex < activeQuiz.questions.length - 1 ? <button className="button-primary" onClick={() => setQuestionIndex((index) => Math.min(activeQuiz.questions.length - 1, index + 1))}>Next question <ArrowRight size={15} /></button> : <button className="button-primary" onClick={() => submitAttempt(false)} disabled={submitting}><Send size={15} /> {submitting ? 'Submitting…' : 'Submit quiz'}</button>}</div></section>
    </div>
  </div>

  return <div className="student-quizzes-page">
    <div className="section-title-row"><div><div className="section-kicker">CHECK YOUR UNDERSTANDING</div><h1>Quizzes & exams</h1><p>Review the instructions, take timed assessments, and see released results.</p></div></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="student-quiz-list">{quizzes.length ? quizzes.map((quiz) => {
      const latest = quiz.attempt
      const isActive = latest?.status === 'in_progress'
      const isAvailable = quiz.status === 'published' && (!quiz.startDate || new Date(quiz.startDate) <= new Date()) && (!quiz.endDate || new Date(quiz.endDate) > new Date())
      const canRetake = (quiz.attempts?.length || 0) < (quiz.attemptLimit || 1)
      return <article className="panel student-quiz-card" key={quiz._id}><div className="student-quiz-mark"><FileQuestion size={20} /></div><div className="student-quiz-main"><div className="student-quiz-heading"><h2>{quiz.title}</h2><span className={`status-pill ${isActive ? 'status-pending' : quiz.status === 'closed' ? 'status-inactive' : 'status-complete'}`}>{isActive ? 'In progress' : quiz.status}</span></div><p>{quiz.description || quiz.instructions || 'Timed class assessment'}</p><div className="content-card-meta"><span>{quiz.questions.length} questions</span><span>{quiz.totalMarks} marks</span><span><Clock3 size={13} /> {quiz.durationMinutes} minutes</span><span>Closes {formatDate(quiz.endDate)}</span></div>{quiz.attempts?.length > 0 && <div className="student-attempt-history"><b>Attempt history</b>{quiz.attempts.map((attempt, index) => { const scoreAvailable = attempt.scoreAvailable ?? (quiz.resultsReleased && attempt.score !== null); return <span key={attempt.id}>Attempt {quiz.attempts.length - index}: {attempt.status.replace('_', ' ')}{scoreAvailable && attempt.score !== null ? ` · ${attempt.score}/${attempt.maxScore}` : ''}<button className="student-view-marks" onClick={() => scoreAvailable ? openResult(attempt.id) : toast('Your marks will appear here when grading is complete.')} disabled={!scoreAvailable}><EyeIcon /> View your marks</button>{attempt.status !== 'in_progress' && <button className="student-view-marks" onClick={() => openReview(attempt.id)}><Eye size={14} /> Review questions</button>}</span> })}</div>}</div><div className="student-quiz-actions"><button className="button-secondary" onClick={() => viewDetails(quiz)}><FileQuestion size={14} /> Instructions</button>{isActive ? <button className="button-primary" onClick={() => openAttempt(quiz)}><Play size={14} /> Continue</button> : <button className="button-primary" disabled={!isAvailable || !canRetake} onClick={() => openAttempt(quiz)}><Play size={14} /> {latest ? canRetake ? 'Retake quiz' : 'Attempt complete' : isAvailable ? 'Start quiz' : 'Not available'}</button>}</div></article>
    }) : <EmptyState title="No quizzes available" description="Published quizzes for your class will appear here." icon={Timer} />}</div>
    {details && <div className="modal-backdrop" role="presentation"><section className="panel student-quiz-details" role="dialog" aria-modal="true" aria-labelledby="student-quiz-title"><div className="panel-heading"><div><span className="section-kicker">QUIZ INSTRUCTIONS</span><h2 id="student-quiz-title">{details.title}</h2></div><button className="icon-button" onClick={() => setDetails(null)} aria-label="Close"><X size={18} /></button></div><p>{details.description}</p>{details.instructions && <div className="student-quiz-instructions">{details.instructions}</div>}<div className="student-quiz-detail-meta"><span>{details.questions.length} questions</span><span>{details.totalMarks} marks</span><span>{details.durationMinutes} minutes</span><span>Starts {formatDate(details.startDate)}</span><span>Closes {formatDate(details.endDate)}</span></div><div className="student-quiz-details-actions"><button className="button-secondary" onClick={() => setDetails(null)}>Close</button><button className="button-primary" onClick={() => { const quiz = quizzes.find((item) => item._id === details._id); setDetails(null); openAttempt(quiz) }}><Play size={14} /> Begin assessment</button></div></section></div>}
    {review && <div className="modal-backdrop" role="presentation"><section className="panel student-result-modal" role="dialog" aria-modal="true" aria-labelledby="student-review-title"><div className="panel-heading"><div><span className="section-kicker"><Lock size={11} /> READ-ONLY · SUBMITTED</span><h2 id="student-review-title">{review.quiz.title}</h2><p>{review.scoreReleased && review.attempt.score !== null ? `${review.attempt.score} / ${review.attempt.maxScore} marks · ` : ''}Submitted {formatDate(review.attempt.submittedAt)}. You can read your answers but cannot change or resubmit them.</p></div><button className="icon-button" onClick={() => setReview(null)} aria-label="Close"><X size={18} /></button></div><div className="student-result-answers">{review.questions.map((question, index) => <article key={question.id}><div><b>{index + 1}. {question.questionText}</b><span>{question.marksAwarded !== undefined && question.marksAwarded !== null ? `${question.marksAwarded} / ` : ''}{question.marks} marks</span></div>{question.questionType === 'short_answer' ? <textarea readOnly disabled rows="4" value={question.textAnswer || 'No response'} style={{ width: '100%', marginTop: 7, resize: 'vertical' }} /> : <div className="active-quiz-options">{question.options.map((option, optionIndex) => <label key={optionIndex} className={question.selectedOption === optionIndex ? 'active-quiz-option-selected' : ''} style={{ cursor: 'default' }}><input type="radio" disabled readOnly name={`review-${question.id}`} checked={question.selectedOption === optionIndex} /><span className="active-option-marker">{question.selectedOption === optionIndex ? <Check size={14} /> : <Circle size={14} />}</span>{option}{review.detailsReleased && question.correctOption === optionIndex ? ' ✓' : ''}</label>)}</div>}{question.questionType !== 'short_answer' && question.selectedOption === null && <p>No response</p>}{question.feedback && <small>{question.feedback}</small>}</article>)}</div><div className="student-quiz-details-actions"><button className="button-secondary" onClick={() => setReview(null)}>Close</button></div></section></div>}
    {result && <div className="modal-backdrop" role="presentation"><section className="panel student-result-modal" role="dialog" aria-modal="true" aria-labelledby="student-result-title"><div className="panel-heading"><div><span className="section-kicker">ASSESSMENT RESULT</span><h2 id="student-result-title">{result.released ? `${result.result.score} / ${result.result.maxScore} marks` : 'Marks pending'}</h2><p>{result.released ? `Submitted ${formatDate(result.result.submittedAt)}` : 'Your quiz was submitted. Your teacher will grade any written answers.'}</p></div><button className="icon-button" onClick={() => setResult(null)} aria-label="Close"><X size={18} /></button></div>{result.released && !result.detailsReleased && <p className="student-result-pending-details">Your marks are ready. Detailed answers and feedback will appear when your teacher releases them.</p>}{result.released && result.result.questions && <div className="student-result-answers">{result.result.questions.map((question, index) => <article key={question.id}><div><b>{index + 1}. {question.questionText}</b><span>{question.marksAwarded ?? 'Pending'} / {question.marks} marks</span></div>{result.detailsReleased && <><p>Your answer: {question.questionType === 'short_answer' ? question.textAnswer || 'No response' : question.options[question.selectedOption] || 'No response'}</p>{question.feedback && <small>{question.feedback}</small>}{question.questionType !== 'short_answer' && <small>Correct answer: {question.questionType === 'true_false' ? question.correctAnswer ? 'True' : 'False' : question.options[question.correctOption]}</small>}</>}</article>)}</div>}</section></div>}
  </div>
}

function EyeIcon() { return <CheckCircle2 size={14} /> }
