import { useEffect, useState } from 'react'
import { Megaphone, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../services/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageLoading } from '../components/ui/States.jsx'
import './AnnouncementsPage.css'

export default function AnnouncementsPage() {
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const emptyForm = { title: '', message: '', emailAudience: 'none', emailTarget: '' }
  const [form, setForm] = useState(emptyForm)
  const [academic, setAcademic] = useState({ faculties: [], departments: [], classes: [] })
  async function load() {
    try { const { data } = await api.get('/announcements'); setAnnouncements(data.announcements || []) }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (user?.role !== 'admin') return
    api.get('/academic/options').then(({ data }) => setAcademic({ faculties: data.faculties || [], departments: data.departments || [], classes: data.classes || [] })).catch(() => {})
  }, [user?.role])
  const targetOptions = form.emailAudience === 'faculty' ? academic.faculties : form.emailAudience === 'department' ? academic.departments : form.emailAudience === 'class' ? academic.classes : []
  async function submit(event) {
    event.preventDefault(); setSaving(true)
    if (form.emailAudience === 'all_students' && !window.confirm('Email this announcement to every active student? Emails use the shared daily sending quota.')) { setSaving(false); return }
    try {
      const payload = { title: form.title, message: form.message, emailAudience: form.emailAudience, ...(targetOptions.length || form.emailTarget ? { emailTarget: form.emailTarget } : {}) }
      const { data } = await api.post('/announcements', payload)
      setAnnouncements((current) => [data.announcement, ...current]); setForm(emptyForm)
      toast.success(form.emailAudience === 'none' ? 'Announcement published' : 'Announcement published; emails are being queued')
    }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setSaving(false) }
  }
  return <div className="announcements-page">
    <div className="section-title-row"><div><div className="section-kicker">UNIVERSITY UPDATES</div><h1>Announcements</h1><p>Updates from the university administration.</p></div></div>
    {user?.role === 'admin' && <form className="panel announcement-compose" onSubmit={submit}><div className="panel-heading"><div><h2>Publish an announcement</h2><p>Teachers and students will be able to view it.</p></div><Megaphone size={19} /></div><label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Message<textarea required maxLength={5000} rows={5} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label><div className="announcement-email-row"><label>Email notification<select value={form.emailAudience} onChange={(event) => setForm({ ...form, emailAudience: event.target.value, emailTarget: '' })}><option value="none">Don’t send email (in-app only)</option><option value="class">Email students in a class</option><option value="department">Email students in a department</option><option value="faculty">Email students in a faculty</option><option value="all_students">Email all students</option></select></label>{['class', 'department', 'faculty'].includes(form.emailAudience) && <label>{form.emailAudience[0].toUpperCase() + form.emailAudience.slice(1)}<select required value={form.emailTarget} onChange={(event) => setForm({ ...form, emailTarget: event.target.value })}><option value="">Choose {form.emailAudience}</option>{targetOptions.map((item) => <option key={item._id} value={item._id}>{item.name}{item.code || item.classCode ? ` · ${item.code || item.classCode}` : ''}</option>)}</select></label>}</div><div className="announcement-actions"><button className="button-primary" disabled={saving}><Send size={15} />{saving ? 'Publishing…' : 'Publish'}</button></div></form>}
    {loading ? <PageLoading /> : <div className="announcement-list">{announcements.map((item) => <article className="panel announcement-card" key={item._id}><div className="announcement-card-heading"><div><h2>{item.title}</h2><small>{item.author?.fullName || 'Administration'} · {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</small></div><Megaphone size={18} /></div><p>{item.message}</p></article>)}{!announcements.length && <div className="panel announcement-empty">There are no announcements yet.</div>}</div>}
  </div>
}
