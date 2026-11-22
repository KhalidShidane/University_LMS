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
  const [form, setForm] = useState({ title: '', message: '' })
  async function load() {
    try { const { data } = await api.get('/announcements'); setAnnouncements(data.announcements || []) }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  async function submit(event) {
    event.preventDefault(); setSaving(true)
    try { const { data } = await api.post('/announcements', form); setAnnouncements((current) => [data.announcement, ...current]); setForm({ title: '', message: '' }); toast.success('Announcement published') }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setSaving(false) }
  }
  return <div className="announcements-page">
    <div className="section-title-row"><div><div className="section-kicker">UNIVERSITY UPDATES</div><h1>Announcements</h1><p>Updates from the university administration.</p></div></div>
    {user?.role === 'admin' && <form className="panel announcement-compose" onSubmit={submit}><div className="panel-heading"><div><h2>Publish an announcement</h2><p>Teachers and students will be able to view it.</p></div><Megaphone size={19} /></div><label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Message<textarea required maxLength={5000} rows={5} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label><div className="announcement-actions"><button className="button-primary" disabled={saving}><Send size={15} />{saving ? 'Publishing…' : 'Publish'}</button></div></form>}
    {loading ? <PageLoading /> : <div className="announcement-list">{announcements.map((item) => <article className="panel announcement-card" key={item._id}><div className="announcement-card-heading"><div><h2>{item.title}</h2><small>{item.author?.fullName || 'Administration'} · {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</small></div><Megaphone size={18} /></div><p>{item.message}</p></article>)}{!announcements.length && <div className="panel announcement-empty">There are no announcements yet.</div>}</div>}
  </div>
}
