import { useEffect, useState } from 'react'
import { Bell, CheckCheck, Inbox, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../services/api.js'
import { EmptyState, ErrorState, PageLoading } from '../components/ui/States.jsx'
import { notificationPath } from '../utils/notificationLinks.js'
import './NotificationCenterPage.css'

const timeLabel = (value) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function NotificationCenterPage() {
  const [notifications, setNotifications] = useState([])
  const [pagination, setPagination] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function load(page = 1) {
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/notifications', { params: { page, limit: 20, ...(unreadOnly ? { unread: true } : {}) } })
      setNotifications(data.notifications); setPagination(data.pagination); setUnreadCount(data.unreadCount)
    } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [unreadOnly])

  async function markRead(item) {
    if (item.isRead) return
    try { await api.patch(`/notifications/${item._id}/read`); setNotifications((list) => list.map((entry) => entry._id === item._id ? { ...entry, isRead: true } : entry)); setUnreadCount((count) => Math.max(0, count - 1)) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function markAll() {
    try { await api.patch('/notifications/read-all'); setUnreadCount(0); if (unreadOnly) { await load() } else { setNotifications((items) => items.map((item) => ({ ...item, isRead: true }))) }; toast.success('All notifications marked as read') } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function remove(item) {
    try { await api.delete(`/notifications/${item._id}`); setNotifications((items) => items.filter((entry) => entry._id !== item._id)); if (!item.isRead) setUnreadCount((count) => Math.max(0, count - 1)) } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  async function open(item) { await markRead(item); navigate(notificationPath(item)) }

  if (loading && !pagination) return <PageLoading />
  if (error && !pagination) return <ErrorState message={error} onRetry={() => load()} />
  return <div className="notification-center-page"><div className="section-title-row"><div><div className="section-kicker">YOUR ACTIVITY</div><h1>Notifications</h1><p>Important updates about your classes, coursework, and messages.</p></div><div className="notification-center-count"><Bell size={17} /> {unreadCount} unread</div></div>
    <section className="panel notification-center-panel"><div className="notification-center-toolbar"><div className="notification-filter-tabs"><button className={!unreadOnly ? 'notification-filter-active' : ''} onClick={() => setUnreadOnly(false)}>All</button><button className={unreadOnly ? 'notification-filter-active' : ''} onClick={() => setUnreadOnly(true)}>Unread</button></div><button className="button-quiet" disabled={!unreadCount} onClick={markAll}><CheckCheck size={15} /> Mark all as read</button></div>
      {error && <p className="inline-error" role="alert">{error}</p>}{loading ? <PageLoading /> : notifications.length ? <div className="notification-center-list">{notifications.map((item) => <article key={item._id} className={`notification-center-item ${item.isRead ? '' : 'notification-unread'}`}><button className="notification-center-main" onClick={() => open(item)}><span className="notification-center-dot" /><span className="notification-center-copy"><b>{item.title}</b><p>{item.message}</p><time>{timeLabel(item.createdAt)}</time></span></button><button className="icon-button notification-delete" onClick={() => remove(item)} aria-label="Delete notification"><Trash2 size={15} /></button></article>)}</div> : <EmptyState title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} description={unreadOnly ? 'You are caught up on everything.' : 'Updates about your academic work will appear here.'} icon={Inbox} />}
      {pagination?.pages > 1 && <div className="notification-pagination"><button className="button-secondary" disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="button-secondary" disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}>Next</button></div>}
    </section></div>
}
