import { useEffect, useState } from 'react'
import { ArrowDownToLine, BookOpenCheck, ClipboardCheck, FilePlus2, LibraryBig, Plus, Send, Timer, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import ProfileAvatar from '../../components/common/ProfileAvatar.jsx'

const dateLabel = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))

export default function TeacherWorkspacePage({ section = 'classes' }) {
  const navigate = useNavigate()
  const [data, setData] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [grading, setGrading] = useState(null)
  const [form, setForm] = useState({ title: '', summary: '', content: '', class: '', instructions: '', dueDate: '', maxScore: 100, durationMinutes: 20, availableFrom: new Date().toISOString().slice(0, 16), questions: [{ prompt: '', options: ['', '', '', ''], correctOption: 0, points: 1 }] })

  async function load() {
    setLoading(true)
    setError('')
    try {
      const endpoint = { classes: '/teacher/classes', lessons: '/teacher/lessons', assignments: '/teacher/assignments', quizzes: '/teacher/quizzes' }[section]
      const [result, classResult] = await Promise.all([api.get(endpoint), api.get('/teacher/classes')])
      setData(result.data.classes || result.data.lessons || result.data.assignments || result.data.quizzes || [])
      setClasses(classResult.data.classes)
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [section])

  function openForm() {
    setForm({ title: '', summary: '', content: '', class: classes[0]?._id || '', instructions: '', dueDate: '', maxScore: 100, durationMinutes: 20, availableFrom: new Date().toISOString().slice(0, 16), questions: [{ prompt: '', options: ['', '', '', ''], correctOption: 0, points: 1 }] })
    setShowForm(true)
  }

  async function submitForm(event) {
    event.preventDefault()
    setSaving(true)
    const endpoints = { lessons: '/teacher/lessons', assignments: '/teacher/assignments', quizzes: '/teacher/quizzes' }
    let payload
    if (section === 'lessons') payload = { title: form.title, summary: form.summary, content: form.content, class: form.class, isPublished: true }
    if (section === 'assignments') payload = { title: form.title, instructions: form.instructions, class: form.class, dueDate: new Date(form.dueDate).toISOString(), maxScore: Number(form.maxScore), isPublished: true }
    if (section === 'quizzes') payload = { title: form.title, instructions: form.instructions, class: form.class, durationMinutes: Number(form.durationMinutes), availableFrom: new Date(form.availableFrom).toISOString(), questions: form.questions.map((question) => ({ ...question, options: question.options.map((option) => option.trim()).filter(Boolean), correctOption: Number(question.correctOption), points: Number(question.points) })), isPublished: true }
    try {
      await api.post(endpoints[section], payload)
      toast.success(`${section.slice(0, -1)} published`)
      setShowForm(false)
      load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function togglePublished(item) {
    const endpoint = { lessons: 'lessons', assignments: 'assignments', quizzes: 'quizzes' }[section]
    try {
      await api.patch(`/teacher/${endpoint}/${item._id}`, { isPublished: !item.isPublished })
      toast.success(item.isPublished ? 'Item unpublished' : 'Item published')
      load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    }
  }

  async function saveGrade(submission) {
    const score = Number(grading.score)
    try {
      await api.patch(`/teacher/submissions/${submission._id}/grade`, { score, feedback: grading.feedback })
      toast.success('Feedback saved')
      setGrading(null)
      load()
    } catch (requestError) {
      toast.error(apiErrorMessage(requestError))
    }
  }

  function addQuestion() {
    setForm((current) => ({ ...current, questions: [...current.questions, { prompt: '', options: ['', '', '', ''], correctOption: 0, points: 1 }] }))
  }

  function updateQuestion(index, key, value) {
    setForm((current) => ({ ...current, questions: current.questions.map((question, i) => i === index ? { ...question, [key]: value } : question) }))
  }

  function updateOption(questionIndex, optionIndex, value) {
    setForm((current) => ({ ...current, questions: current.questions.map((question, i) => i === questionIndex ? { ...question, options: question.options.map((option, j) => j === optionIndex ? value : option) } : question) }))
  }

  const details = {
    classes: { eyebrow: 'TEACHING', title: 'My classes', description: 'The academic groups assigned to your teaching account.', action: '' },
    lessons: { eyebrow: 'COURSE CONTENT', title: 'Lessons', description: 'Create and publish learning materials for your classes.', action: 'Create lesson' },
    assignments: { eyebrow: 'ASSESSMENT', title: 'Assignments', description: 'Set student work, manage due dates, and review submissions.', action: 'Create assignment' },
    quizzes: { eyebrow: 'ASSESSMENT', title: 'Quizzes', description: 'Build timed quizzes and publish them to your classes.', action: 'Build a quiz' },
  }[section]

  return <>
    <div className="section-title-row"><div><div className="section-kicker">{details.eyebrow}</div><h1>{details.title}</h1><p>{details.description}</p></div>{details.action && <button className="button-primary" onClick={openForm} disabled={!classes.length}><Plus size={16} />{details.action}</button>}</div>
    {error ? <ErrorState message={error} onRetry={load} /> : loading ? <PageLoading /> : section === 'classes' ? <div className="class-card-grid class-list-grid">{data.length ? data.map((item, index) => <article className="class-detail-card" key={item._id} role="link" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/classes/${item._id}`)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/app/classes/${item._id}`) } }}><span className={`class-card-icon ${['blue', 'green', 'violet'][index % 3]}`}><LibraryBig size={20} /></span><div><span className="section-kicker">{item.classCode}</span><h2>{item.name}</h2><p>{item.department?.name || 'Academic department'}{item.department?.faculty?.name ? ` · ${item.department.faculty.name}` : ''}</p><Link className="button-secondary teacher-open-class" to={`/app/classes/${item._id}`} onClick={(e) => e.stopPropagation()}>Open class <BookOpenCheck size={14} /></Link></div><span className="class-status"><i />Active class</span></article>) : <EmptyState title="No assigned classes" description="An administrator can add class assignments to your account." />}</div> : <>
      {showForm && <section className="panel create-panel"><div className="panel-heading"><div><h2>{details.action}</h2><p>New content is saved directly to your academic workspace.</p></div><button className="button-quiet" onClick={() => setShowForm(false)}>Cancel</button></div>
        <form className="form-grid" onSubmit={submitForm}><label className="form-grid-span">Title<input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Class<select required value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })}><option value="">Choose a class</option>{classes.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></label>
          {section === 'lessons' ? <><label>Short summary<input maxLength={500} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label><label className="form-grid-span">Lesson content<textarea required rows="8" maxLength={30000} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Write the lesson content your students need…" /></label></> : <><label className="form-grid-span">Instructions<textarea required rows="4" maxLength={10000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>{section === 'assignments' ? <><label>Due date<input type="datetime-local" required value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label><label>Maximum score<input type="number" min="1" max="1000" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} /></label></> : <><label>Timer (minutes)<input type="number" min="1" max="240" required value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></label><label>Available from<input type="datetime-local" required value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} /></label><div className="form-grid-span question-builder">{form.questions.map((question, index) => <div className="question-editor" key={index}><div className="question-editor-head"><b>Question {index + 1}</b>{form.questions.length > 1 && <button type="button" className="icon-button danger-icon" onClick={() => setForm({ ...form, questions: form.questions.filter((_, i) => i !== index) })} aria-label="Remove question"><Trash2 size={15} /></button>}</div><label>Prompt<input required value={question.prompt} onChange={(e) => updateQuestion(index, 'prompt', e.target.value)} /></label><div className="option-grid">{question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}<input required value={option} onChange={(e) => updateOption(index, optionIndex, e.target.value)} /></label>)}</div><div className="question-settings"><label>Correct answer<select value={question.correctOption} onChange={(e) => updateQuestion(index, 'correctOption', e.target.value)}>{question.options.map((_, i) => <option value={i} key={i}>Option {i + 1}</option>)}</select></label><label>Points<input type="number" min="1" max="100" value={question.points} onChange={(e) => updateQuestion(index, 'points', e.target.value)} /></label></div></div>)}<button type="button" className="button-secondary" onClick={addQuestion}><Plus size={15} />Add question</button></div></>}</>}
          <div className="form-actions form-grid-span"><button className="button-primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish to class'}<Send size={15} /></button></div></form>
      </section>}
      {section === 'lessons' && <div className="content-card-list">{data.length ? data.map((item) => <article className="content-card" key={item._id}><span className="content-card-icon lesson-color"><BookOpenCheck size={19} /></span><div className="content-card-main"><div className="content-card-title"><h2>{item.title}</h2><span className={`status-pill ${item.isPublished ? 'status-complete' : 'status-inactive'}`}>{item.isPublished ? 'Published' : 'Draft'}</span></div><p>{item.summary || item.content.slice(0, 180)}</p><div className="content-card-meta"><span>{item.class?.classCode} · {item.class?.name}</span><span>Updated {dateLabel(item.updatedAt)}</span></div></div><button className="table-action" onClick={() => togglePublished(item)}>{item.isPublished ? 'Unpublish' : 'Publish'}</button></article>) : <EmptyState title="No lessons created" description="Create your first lesson and share it with an assigned class." icon={BookOpenCheck} />}</div>}
      {section === 'assignments' && <div className="content-card-list">{data.length ? data.map((item) => <article className="panel assignment-panel" key={item._id}><div className="panel-heading"><div><span className="section-kicker">{item.class?.classCode} · DUE {dateLabel(item.dueDate)}</span><h2>{item.title}</h2><p>{item.instructions}</p></div><button className="table-action" onClick={() => togglePublished(item)}>{item.isPublished ? 'Unpublish' : 'Publish'}</button></div><div className="assignment-submissions"><div className="submission-section-title"><b>Submissions</b><span>{item.submissions.length} received</span></div>{item.submissions.length ? item.submissions.map((submission) => <div className="submission-row" key={submission._id}><ProfileAvatar user={submission.student} size="small" /><span className="submission-person"><b>{submission.student?.fullName}</b><small>{submission.student?.studentId} · submitted {dateLabel(submission.submittedAt)}</small></span><span className={`status-pill ${submission.score === null ? 'status-pending' : 'status-complete'}`}>{submission.score === null ? submission.status === 'late' ? 'Late' : 'To grade' : `${submission.score} / ${item.maxScore}`}</span><button className="icon-button" onClick={async () => { try { const { data: blob } = await api.get(`/teacher/submissions/${submission._id}/file`, { responseType: 'blob' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'submission.pdf'; anchor.click(); URL.revokeObjectURL(url) } catch { toast.error('Could not download submission') } }} title="Download PDF" aria-label="Download PDF"><ArrowDownToLine size={17} /></button><button className="button-quiet" onClick={() => setGrading({ id: submission._id, score: submission.score ?? '', feedback: submission.feedback || '' })}>{submission.score === null ? 'Grade' : 'Edit feedback'}</button>{grading?.id === submission._id && <div className="grading-form"><label>Score<input type="number" min="0" max={item.maxScore} value={grading.score} onChange={(e) => setGrading({ ...grading, score: e.target.value })} /></label><label>Feedback<textarea rows="2" value={grading.feedback} onChange={(e) => setGrading({ ...grading, feedback: e.target.value })} /></label><button className="button-primary" onClick={() => saveGrade(submission)}>Save feedback</button></div>}</div>) : <p className="inline-empty">No submissions have been received yet.</p>}</div></article>) : <EmptyState title="No assignments yet" description="Create an assignment to start collecting student work." icon={ClipboardCheck} />}</div>}
      {section === 'quizzes' && <div className="content-card-list">{data.length ? data.map((item) => <article className="content-card" key={item._id}><span className="content-card-icon quiz-color"><Timer size={19} /></span><div className="content-card-main"><div className="content-card-title"><h2>{item.title}</h2><span className={`status-pill ${item.isPublished ? 'status-complete' : 'status-inactive'}`}>{item.isPublished ? 'Published' : 'Draft'}</span></div><p>{item.instructions || 'Timed quiz'}</p><div className="content-card-meta"><span>{item.class?.classCode} · {item.class?.name}</span><span>{item.questions.length} questions · {item.durationMinutes} min</span></div></div><button className="table-action" onClick={() => togglePublished(item)}>{item.isPublished ? 'Unpublish' : 'Publish'}</button></article>) : <EmptyState title="No quizzes created" description="Build a timed quiz with questions for one of your classes." icon={Timer} />}</div>}
    </>}
  </>
}
