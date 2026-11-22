import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { notificationPath } from '../../utils/notificationLinks.js'
import './NotificationBell.css'

const timeLabel = (value) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value))
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const root = useRef(null)
  const navigate = useNavigate()

  async function refresh(includeList = open) {
    try {
      const [{ data: count }] = await Promise.all([api.get('/notifications/unread-count')])
      setUnreadCount(count.unreadCount)
      if (includeList) {
        setLoading(true)
        const { data } = await api.get('/notifications?limit=6')
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
      }
    } catch (e) { if (includeList) toast.error(apiErrorMessage(e)) } finally { setLoading(false) }
  }

  useEffect(() => {
    refresh(false)
    const stream = new EventSource('/api/notifications/stream', { withCredentials: true })
    const handleNotification = (event) => {
      try {
        const notification = JSON.parse(event.data)
        setUnreadCount((count) => count + 1)
        setNotifications((items) => [notification, ...items.filter((item) => item._id !== notification._id)].slice(0, 6))
        if (document.visibilityState === 'visible') toast(notification.title, { icon: '●', duration: 3200 })
      } catch { /* Ignore malformed stream events and recover through REST refresh. */ }
    }
    stream.addEventListener('notification', handleNotification)
    stream.onopen = () => refresh(false)
    const refreshInterval = setInterval(() => refresh(false), 60_000)
    return () => { stream.removeEventListener('notification', handleNotification); stream.close(); clearInterval(refreshInterval) }
  }, [])

  useEffect(() => {
    if (open) refresh(true)
  }, [open])

  useEffect(() => {
    const outside = (event) => { if (open && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  async function markAll() {
    try { await api.patch('/notifications/read-all'); setNotifications((items) => items.map((item) => ({ ...item, isRead: true }))); setUnreadCount(0) } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function openNotification(item) {
    if (!item.isRead) {
      try { await api.patch(`/notifications/${item._id}/read`); setUnreadCount((count) => Math.max(0, count - 1)); setNotifications((items) => items.map((entry) => entry._id === item._id ? { ...entry, isRead: true } : entry)) } catch { /* Navigation remains available while unread state retries on the next refresh. */ }
    }
    setOpen(false); navigate(notificationPath(item))
  }

  return <div className="notification-bell" ref={root}>
    <button className={`notification-bell-button ${open ? 'notification-bell-active' : ''}`} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={18} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
    {open && <section className="notification-popover" aria-label="Recent notifications"><header><div><b>Notifications</b><small>{unreadCount ? `${unreadCount} unread` : 'You are all caught up'}</small></div><button className="notification-mark-all" onClick={markAll} disabled={!unreadCount}><CheckCheck size={14} /> Mark all read</button></header><div className="notification-popover-list">{loading && !notifications.length ? <p className="notification-popover-empty">Loading notifications…</p> : notifications.length ? notifications.map((item) => <button className={`notification-popover-item ${item.isRead ? '' : 'notification-unread'}`} key={item._id} onClick={() => openNotification(item)}><i /> <span><b>{item.title}</b><small>{item.message}</small><time>{timeLabel(item.createdAt)}</time></span></button>) : <p className="notification-popover-empty">You have no notifications yet.</p>}</div><button className="notification-view-all" onClick={() => { setOpen(false); navigate('/app/notifications') }}>View notification center <ChevronRight size={15} /></button></section>}
  </div>
}
