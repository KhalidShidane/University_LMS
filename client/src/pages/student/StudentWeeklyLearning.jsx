import { useEffect, useState } from 'react'
import { ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, Clock3, FileQuestion } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../../components/ui/States.jsx'
import './StudentWeeklyLearning.css'

const weekStart = (value) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const datePart = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  const date = new Date(Date.UTC(Number(datePart.year), Number(datePart.month) - 1, Number(datePart.day)))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date
}

const dateLabel = (value) => new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
const timeLabel = (value) => new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value))

export default function StudentWeeklyLearning() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/student/weekly-learning')
      setItems(data.items || [])
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const groups = new Map()
  for (const item of items) {
    const start = weekStart(item.postedAt)
    const key = start.toISOString().slice(0, 10)
    const group = groups.get(key) || { key, start, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  const weeks = [...groups.values()].sort((a, b) => b.start - a.start)

  function openItem(item) {
    if (item.type === 'lesson') navigate(item.courseId ? `/app/learning/courses/${item.courseId}/lessons/${item.id}` : '/app/learning')
    else if (item.type === 'assignment') navigate(`/app/assignments/${item.id}`)
    else navigate('/app/quizzes')
  }

  if (loading) return <section className="panel student-weekly-panel"><PageLoading /></section>
  if (error) return <section className="panel student-weekly-panel"><ErrorState message={error} onRetry={load} /></section>

  return <section className="panel student-weekly-panel">
    <div className="panel-heading"><div><h2>Weekly learning</h2><p>Lessons, assignments, and quizzes posted each week</p></div><CalendarDays size={18} className="panel-heading-icon" /></div>
    {weeks.length ? <div className="student-week-list">{weeks.map((week) => {
      const end = new Date(week.start)
      end.setUTCDate(end.getUTCDate() + 6)
      return <section className="student-week" key={week.key}>
        <div className="student-week-heading"><h3>{week.start <= weekStart(new Date()) && weekStart(new Date()) <= end ? 'This week' : `${dateLabel(week.start)} – ${dateLabel(end)}`}</h3><span>{week.items.length} {week.items.length === 1 ? 'item' : 'items'}</span></div>
        <div className="student-week-items">{week.items.map((item) => {
          const Icon = item.type === 'lesson' ? BookOpenCheck : item.type === 'assignment' ? CheckCircle2 : FileQuestion
          const status = item.type === 'assignment' ? item.submissionStatus === 'not_submitted' ? 'To do' : item.submissionStatus.replace(/_/g, ' ') : item.type === 'quiz' ? item.attemptStatus.replace(/_/g, ' ') : 'Learning material'
          return <button className="student-week-item" key={`${item.type}-${item.id}`} onClick={() => openItem(item)}>
            <span className={`student-week-item-icon student-week-${item.type}`}><Icon size={16} /></span>
            <span className="student-week-item-copy"><b>{item.title}</b><small>{item.type}{item.courseName ? ` · ${item.courseName}` : ''} · posted {timeLabel(item.postedAt)}</small></span>
            <span className="student-week-item-meta">{item.dueDate ? <small><Clock3 size={12} /> Due {dateLabel(item.dueDate)}</small> : null}<span className={`status-pill ${status === 'graded' || status === 'Learning material' ? 'status-complete' : status === 'To do' ? 'status-pending' : ''}`}>{status}</span></span>
            <ArrowRight size={15} className="student-week-item-arrow" />
          </button>
        })}</div>
      </section>
    })}</div> : <EmptyState title="No weekly learning items yet" description="Published lessons, assignments, and quizzes will be organized here by the week they are posted." icon={CalendarDays} />}
  </section>
}