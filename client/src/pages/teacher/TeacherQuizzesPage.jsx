import { useEffect, useMemo, useState } from 'react'
import GradebookExport from '../../components/common/GradebookExport.jsx'
import { ArrowDown, ArrowUp, BookOpenCheck, Check, ClipboardList, Clock3, Eye, EyeOff, Pencil, Plus, Send, Timer, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import GradeScalePicker, { ratingFor } from '../../components/common/GradeScalePicker.jsx'
import './TeacherQuizzesPage.css'

const emptyQuestion = () => ({ questionType: 'multiple_choice', questionText: '', options: ['', ''], correctAnswer: 0, marks: 1 })
const emptyForm = (classId = '') => ({ title: '', description: '', instructions: '', classId, durationMinutes: 30, status: 'draft', showResults: false, questions: [emptyQuestion()] })
const dateLabel = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'No end date'

export default function TeacherQuizzesPage() {
  const [quizzes, setQuizzes] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [attemptsFor, setAttemptsFor] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [grading, setGrading] = useState(null)
  const [picker, setPicker] = useState(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const [quizResponse, classResponse] = await Promise.all([api.get('/teacher/quizzes'), api.get('/teacher/classes')])
      setQuizzes(quizResponse.data.quizzes); setClasses(classResponse.data.classes)
    } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const totalMarks = useMemo(() => form?.questions.reduce((sum, question) => sum + (Number(question.marks) || 0), 0) || 0, [form])
  function beginCreate() { setEditing(null); setForm(emptyForm(classes[0]?._id || '')) }
  function beginEdit(quiz) {
    if (quiz.attemptsCount > 0) return toast.error('Questions are locked because students have started this quiz.')
    setEditing(quiz)
    setForm({ title: quiz.title, description: quiz.description || '', instructions: quiz.instructions || '', classId: quiz.classId?._id || quiz.classId || quiz.class?._id || quiz.class, durationMinutes: quiz.durationMinutes, status: quiz.status, showResults: quiz.showResults, questions: quiz.questions.map((q) => ({ questionType: q.questionType || 'multiple_choice', questionText: q.questionText || q.prompt, options: q.options || [], correctAnswer: q.correctAnswer ?? q.correctOption ?? 0, marks: q.marks || q.points || 1 })) })
  }
  function changeQuestion(index, field, value) { setForm((current) => ({ ...current, questions: current.questions.map((q, i) => i === index ? { ...q, [field]: value } : q) })) }
  function changeOption(index, optionIndex, value) { setForm((current) => ({ ...current, questions: current.questions.map((q, i) => i === index ? { ...q, options: q.options.map((option, j) => j === optionIndex ? value : option) } : q) })) }
  function moveQuestion(index, shift) {
    const target = index + shift
    if (target < 0 || target >= form.questions.length) return
    const questions = [...form.questions]; [questions[index], questions[target]] = [questions[target], questions[index]]
    setForm((current) => ({ ...current, questions }))
  }
  async function saveQuiz(event) {
    event.preventDefault(); setSaving(true)
    const payload = { ...form, durationMinutes: Number(form.durationMinutes), startDate: new Date().toISOString(), endDate: null, questions: form.questions.map((q, order) => ({ ...q, order, marks: Number(q.marks), correctAnswer: q.questionType === 'true_false' ? q.correctAnswer === true || q.correctAnswer === 'true' : Number(q.correctAnswer) })) }
    try {
      if (editing) await api.put(`/teacher/quizzes/${editing._id}`, payload)
      else await api.post('/teacher/quizzes', payload)
      toast.success(editing ? 'Quiz updated' : 'Quiz created')
      setEditing(null); setForm(null); await load()
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setSaving(false) }
  }
  async function setStatus(quiz, status) {
    if (status === 'published' && quiz.status === 'closed' && !window.confirm(`Reopen “${quiz.title}” for students? They will be able to start new attempts while the quiz is open. Existing attempts and results will be kept.`)) return
    try { await api.patch(`/teacher/quizzes/${quiz._id}/status`, { status }); toast.success(`Quiz ${status}`); await load() } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function toggleResults(quiz) {
    try { await api.patch(`/teacher/quizzes/${quiz._id}/results`, { showResults: !quiz.showResults }); toast.success(quiz.showResults ? 'Results hidden from students' : 'Results released to students'); await load() } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function viewAttempts(quiz) {
    try { const { data } = await api.get(`/teacher/quizzes/${quiz._id}/attempts`); setAttemptsFor(data.quiz); setAttempts(data.attempts) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function gradeAnswer(attempt, questionId) {
    if (!grading || grading.attemptId !== attempt.id || grading.questionId !== questionId) return
    if (grading.marks === '' || grading.marks === null) return toast.error('Choose a grade first')
    try {
      await api.patch(`/teacher/attempts/${attempt.id}/grade`, { questionId, marksAwarded: Number(grading.marks), feedback: grading.feedback })
      toast.success('Answer graded'); setGrading(null); await viewAttempts(attemptsFor)
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  if (loading) return <PageLoading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return <div className="teacher-quizzes-page">
    <div className="section-title-row"><div><div className="section-kicker">ASSESSMENT MANAGEMENT</div><h1>Quizzes & exams</h1><p>Create timed assessments, review attempts, and release results to your classes.</p></div><div className="section-title-actions"><GradebookExport type="quizzes" /><button className="button-primary" onClick={beginCreate}><Plus size={16} /> Build a quiz</button></div></div>
    {form && <section className="panel quiz-builder-panel"><div className="panel-heading"><div><span className="section-kicker">QUESTION BUILDER</span><h2>{editing ? 'Edit quiz' : 'Create a quiz'}</h2><p>Choose a class, set a time limit, then add questions and marks.</p></div><button className="icon-button" onClick={() => { setForm(null); setEditing(null) }} aria-label="Close builder"><X size={18} /></button></div>
      <form className="quiz-builder-form" onSubmit={saveQuiz}>
        <div className="quiz-builder-grid"><label>Quiz title<input required maxLength="160" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Class<select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">Choose class</option>{classes.map((item) => <option value={item._id} key={item._id}>{item.classCode} · {item.name}</option>)}</select></label><label>Duration (minutes)<input required type="number" min="1" max="600" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></label><label>Save status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="published">Publish now</option><option value="closed">Closed</option></select></label></div>
        <label>Description<textarea rows="2" maxLength="5000" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><label>Student instructions<textarea rows="3" maxLength="5000" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
        <div className="quiz-question-builder-heading"><div><h3>Questions</h3><p>{form.questions.length} questions · {totalMarks} total marks</p></div><button className="button-secondary" type="button" onClick={() => setForm({ ...form, questions: [...form.questions, emptyQuestion()] })}><Plus size={15} /> Add question</button></div>
        <div className="quiz-question-builder">{form.questions.map((question, index) => <article className="quiz-question-editor" key={index}><div className="quiz-question-editor-top"><b>Question {index + 1}</b><div><button type="button" className="icon-button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="Move question up"><ArrowUp size={15} /></button><button type="button" className="icon-button" onClick={() => moveQuestion(index, 1)} disabled={index === form.questions.length - 1} aria-label="Move question down"><ArrowDown size={15} /></button><button type="button" className="icon-button danger-icon" onClick={() => setForm({ ...form, questions: form.questions.filter((_, i) => i !== index) })} disabled={form.questions.length === 1} aria-label="Remove question"><Trash2 size={15} /></button></div></div>
          <div className="quiz-question-fields"><label>Question text<textarea required rows="2" maxLength="2000" value={question.questionText} onChange={(e) => changeQuestion(index, 'questionText', e.target.value)} /></label><label>Type<select value={question.questionType} onChange={(e) => changeQuestion(index, 'questionType', e.target.value)}><option value="multiple_choice">Multiple choice</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option></select></label><label>Marks<input type="number" min="0.5" max="1000" step="0.5" value={question.marks} onChange={(e) => changeQuestion(index, 'marks', e.target.value)} /></label></div>
          {question.questionType === 'multiple_choice' && <><div className="quiz-option-builder">{question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}<input required maxLength="500" value={option} onChange={(e) => changeOption(index, optionIndex, e.target.value)} /></label>)}</div><div className="quiz-answer-row"><label>Correct option<select value={question.correctAnswer} onChange={(e) => changeQuestion(index, 'correctAnswer', e.target.value)}>{question.options.map((_, i) => <option value={i} key={i}>Option {i + 1}</option>)}</select></label>{question.options.length < 8 && <button className="button-quiet" type="button" onClick={() => changeQuestion(index, 'options', [...question.options, ''])}><Plus size={14} /> Add option</button>}{question.options.length > 2 && <button className="button-quiet" type="button" onClick={() => changeQuestion(index, 'options', question.options.slice(0, -1))}>Remove last option</button>}</div></>}
          {question.questionType === 'true_false' && <label className="quiz-correct-bool">Correct answer<select value={String(question.correctAnswer === true || question.correctAnswer === 'true')} onChange={(e) => changeQuestion(index, 'correctAnswer', e.target.value === 'true')}><option value="true">True</option><option value="false">False</option></select></label>}
          {question.questionType === 'short_answer' && <p className="quiz-manual-note">Students type a response. You will grade it after they submit.</p>}
        </article>)}</div>
        <div className="quiz-builder-footer"><span><Timer size={15} /> {form.durationMinutes || 0} min · {totalMarks} marks</span><div><button type="button" className="button-secondary" onClick={() => { setForm(null); setEditing(null) }}>Cancel</button><button className="button-primary" disabled={saving || !classes.length}>{saving ? 'Saving…' : editing ? 'Save changes' : form.status === 'published' ? 'Create and publish' : 'Save quiz'}<Send size={15} /></button></div></div>
      </form></section>}
    <div className="teacher-quiz-list">{quizzes.length ? quizzes.map((quiz) => <article className="panel teacher-quiz-card" key={quiz._id}><div className="teacher-quiz-icon"><ClipboardList size={19} /></div><div className="teacher-quiz-content"><div className="teacher-quiz-title"><h2>{quiz.title}</h2><span className={`status-pill ${quiz.status === 'published' ? 'status-complete' : quiz.status === 'closed' ? 'status-inactive' : 'status-pending'}`}>{quiz.status}</span></div><p>{quiz.description || quiz.instructions || 'Timed class assessment'}</p><div className="content-card-meta"><span>{quiz.class?.classCode || quiz.classId?.classCode} · {quiz.class?.name || quiz.classId?.name}</span><span>{quiz.questions.length} questions · {quiz.totalMarks} marks</span><span><Clock3 size={13} /> {quiz.durationMinutes} min</span></div></div><div className="teacher-quiz-actions"><button className="button-secondary" onClick={() => viewAttempts(quiz)}><Eye size={14} /> Attempts ({quiz.attemptsCount || 0})</button>{quiz.status === 'draft' ? <button className="button-primary" onClick={() => setStatus(quiz, 'published')}>Publish</button> : quiz.status === 'published' ? <button className="button-secondary" onClick={() => setStatus(quiz, 'closed')}>Close</button> : <button className="button-secondary" onClick={() => setStatus(quiz, 'published')}>Reopen</button>}{quiz.attemptsCount === 0 && <button className="icon-button" onClick={() => beginEdit(quiz)} title="Edit quiz"><Pencil size={16} /></button>}<button className="button-quiet" onClick={() => toggleResults(quiz)}>{quiz.showResults ? <><EyeOff size={14} /> Hide results</> : <><Check size={14} /> Release results</>}</button></div></article>) : <EmptyState title="No quizzes yet" description="Build a timed quiz or exam and assign it to one of your classes." icon={BookOpenCheck} />}</div>
    {attemptsFor && <div className="modal-backdrop" role="presentation"><section className="panel quiz-attempts-modal" role="dialog" aria-modal="true" aria-labelledby="attempts-title"><div className="panel-heading"><div><span className="section-kicker">STUDENT WORK</span><h2 id="attempts-title">{attemptsFor.title} · attempts</h2><p>{attempts.length} student attempt{attempts.length === 1 ? '' : 's'}</p></div><button className="icon-button" onClick={() => { setAttemptsFor(null); setGrading(null); setPicker(null) }} aria-label="Close attempts"><X size={18} /></button></div>{attempts.length ? <div className="quiz-attempt-list">{attempts.map((attempt) => <article className="quiz-attempt-row" key={attempt.id}><div className="quiz-attempt-student"><b>{attempt.student?.fullName || 'Student'}</b><small>{attempt.student?.studentId || attempt.student?.email} · started {dateLabel(attempt.startedAt)}</small></div><span className={`status-pill ${attempt.pendingManualGrading ? 'status-pending' : 'status-complete'}`}>{attempt.pendingManualGrading ? 'Needs grading' : attempt.status.replace('_', ' ')}</span><strong>{attempt.score ?? 0} / {attempt.maxScore}</strong><div className="quiz-attempt-answers">{attemptsFor.questions.map((question) => { const answer = attempt.answers.find((item) => item.questionId === question.id); return <div className="quiz-graded-answer" key={question.id}><div><b>{question.questionText}</b><p>{question.questionType === 'short_answer' ? answer?.textAnswer || 'No response' : answer ? question.options[answer.selectedOption] : 'No response'}</p>{answer?.feedback && <small>{answer.feedback}</small>}</div>{answer && <div className="quiz-grade-fields">{(() => { const active = grading?.attemptId === attempt.id && grading.questionId === question.id; const marks = active ? grading.marks : answer.marksAwarded ?? ''; const label = active ? grading.label : ratingFor(answer.marksAwarded, question.marks); return <button type="button" className="button-secondary grade-choice-button" aria-label="Choose grade" disabled={attempt.status === 'in_progress' || attempt.status === 'in-progress'} onClick={() => setPicker({ attemptId: attempt.id, questionId: question.id, maxMarks: question.marks, student: attempt.student?.fullName, feedback: active ? grading.feedback : answer.feedback || '' })}>{marks === '' || marks === null ? 'Choose grade' : `${label ? `${label} · ` : ''}${marks} / ${question.marks}`}</button> })()}<input aria-label="Feedback" placeholder="Feedback for student" value={grading?.attemptId === attempt.id && grading.questionId === question.id ? grading.feedback : answer.feedback || ''} onChange={(e) => setGrading({ attemptId: attempt.id, questionId: question.id, marks: grading?.attemptId === attempt.id && grading.questionId === question.id ? grading.marks : answer.marksAwarded ?? '', label: grading?.attemptId === attempt.id && grading.questionId === question.id ? grading.label : ratingFor(answer.marksAwarded, question.marks), feedback: e.target.value })} /><button className="button-primary" onClick={() => gradeAnswer(attempt, question.id)} disabled={attempt.status === 'in_progress' || attempt.status === 'in-progress' || !grading || grading.attemptId !== attempt.id || grading.questionId !== question.id}>Save grade</button></div>}</div>})}</div></article>)}</div> : <EmptyState title="No attempts received" description="Student attempts will appear here after they begin the quiz." icon={Timer} />}</section></div>}
    {picker && <GradeScalePicker maxMarks={picker.maxMarks} studentName={picker.student} onClose={() => setPicker(null)} onPick={({ label, marks }) => { setGrading({ attemptId: picker.attemptId, questionId: picker.questionId, marks, label, feedback: picker.feedback }); setPicker(null) }} />}
  </div>
}
