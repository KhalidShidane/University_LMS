import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'

const LABELS = {
  quizzes: ['New quizzes', 'When a quiz is published for your class'],
  assignments: ['New assignments', 'When an assignment is published for your class'],
  lessons: ['New lessons', 'When a lesson is published'],
  materials: ['New course materials', 'When files are added to a published lesson'],
  courses: ['New courses', 'When a course becomes available to your class'],
  announcements: ['Announcements', 'When the administration emails an announcement to your group'],
  reminders: ['Deadline reminders', '24 hours and 6 hours before an unfinished quiz or assignment is due'],
}

export default function EmailPreferencesPanel() {
  const [preferences, setPreferences] = useState(null)
  const [savingKey, setSavingKey] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/profile/notification-preferences')
      .then(({ data }) => setPreferences(data.email))
      .catch((requestError) => setError(apiErrorMessage(requestError)))
  }, [])

  async function toggle(key) {
    const next = !preferences[key]
    setSavingKey(key)
    setPreferences((current) => ({ ...current, [key]: next }))
    try {
      const { data } = await api.put('/profile/notification-preferences', { email: { [key]: next } })
      setPreferences(data.email)
      toast.success(`${LABELS[key][0]} emails ${next ? 'turned on' : 'turned off'}`)
    } catch (requestError) {
      setPreferences((current) => ({ ...current, [key]: !next }))
      toast.error(apiErrorMessage(requestError))
    } finally {
      setSavingKey('')
    }
  }

  return <section className="panel email-preferences-panel">
    <div className="panel-heading"><div><h2>Email notifications</h2><p>Choose which updates are also sent to your email address.</p></div><Mail size={18} className="panel-heading-icon" /></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!preferences && !error && <p className="email-preferences-loading">Loading preferences…</p>}
    {preferences && <ul className="email-preferences-list">
      {Object.entries(LABELS).map(([key, [label, description]]) => <li key={key}>
        <div><b>{label}</b><small>{description}</small></div>
        <button type="button" role="switch" aria-checked={preferences[key]} aria-label={`${label} emails`} className={`email-preference-switch ${preferences[key] ? 'is-on' : ''}`} disabled={savingKey === key} onClick={() => toggle(key)}><span /></button>
      </li>)}
      <li className="email-preferences-mandatory"><div><b>Account and security emails</b><small>Email verification and other account messages are always sent.</small></div><span className="status-pill status-complete">Always on</span></li>
    </ul>}
  </section>
}
