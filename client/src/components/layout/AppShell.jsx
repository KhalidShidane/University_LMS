import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BarChart3, BookOpenCheck, Building2, CheckSquare2, ChevronDown, CircleHelp, GraduationCap, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquare, Moon, NotebookPen, School, Settings, ShieldCheck, Sun, UserRound, UsersRound, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import ProfileAvatar from '../common/ProfileAvatar.jsx'
import toast from 'react-hot-toast'
import NotificationBell from '../common/NotificationBell.jsx'
import api from '../../services/api.js'

const navigation = {
  admin: [
    { label: 'Overview', to: '/app/dashboard', icon: LayoutDashboard },
    { label: 'Faculties', to: '/app/faculties', icon: Building2 },
    { label: 'Departments', to: '/app/departments', icon: Building2 },
    { label: 'Courses', to: '/app/courses', icon: BookOpenCheck },
    { label: 'Classes', to: '/app/classes', icon: School },
    { label: 'Teachers', to: '/app/teachers', icon: GraduationCap },
    { label: 'Students', to: '/app/students', icon: UsersRound },
    { label: 'Announcements', to: '/app/announcements', icon: Megaphone },
    { label: 'Analytics', to: '/app/analytics', icon: BarChart3 },
    { label: 'System settings', to: '/app/settings', icon: Settings },
    { label: 'Audit logs', to: '/app/audit-logs', icon: ShieldCheck },
    { label: 'My profile', to: '/app/profile', icon: UserRound },
  ],
  teacher: [
    { label: 'Overview', to: '/app/dashboard', icon: LayoutDashboard },
    { label: 'My classes', to: '/app/classes', icon: School },
    { label: 'Announcements', to: '/app/announcements', icon: Megaphone },
    { label: 'Assignments', to: '/app/assignments', icon: CheckSquare2 },
    { label: 'Quizzes', to: '/app/quizzes', icon: CircleHelp },
    { label: 'Analytics', to: '/app/analytics', icon: BarChart3 },
    { label: 'Messages', to: '/app/messages', icon: MessageSquare },
    { label: 'My profile', to: '/app/profile', icon: UserRound },
  ],
  student: [
    { label: 'Overview', to: '/app/dashboard', icon: LayoutDashboard },
    { label: 'My courses', to: '/app/learning', icon: School },
    { label: 'My notes', to: '/app/notes', icon: NotebookPen },
    { label: 'Announcements', to: '/app/announcements', icon: Megaphone },
    { label: 'Assignments', to: '/app/assignments', icon: CheckSquare2 },
    { label: 'Quizzes', to: '/app/quizzes', icon: CircleHelp },
    { label: 'My performance', to: '/app/analytics', icon: BarChart3 },
    { label: 'Messages', to: '/app/messages', icon: MessageSquare },
    { label: 'My profile', to: '/app/profile', icon: UserRound },
  ],
}

const roleNames = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' }
const pageNames = { dashboard: 'Overview', academic: 'Academic structure', people: 'People & access', faculties: 'Faculties', departments: 'Departments', classes: 'Classes', courses: 'Courses', semesters: 'Semesters', announcements: 'Announcements', teachers: 'Teachers', students: 'Students', learning: 'My courses', lessons: 'Lessons', assignments: 'Assignments', quizzes: 'Quizzes', analytics: 'Reports & analytics', settings: 'System settings', 'audit-logs': 'Audit logs', messages: 'Messages', notes: 'My notes', notifications: 'Notifications', profile: 'My profile' }

export default function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('campus-theme') === 'dark')
  const [currentSemester, setCurrentSemester] = useState('')
  const pathParts = location.pathname.split('/').filter(Boolean)
  const page = ['students', 'teachers'].includes(pathParts.at(-2)) ? pathParts.at(-2) : pathParts.at(-1)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  useEffect(() => { api.get('/academic/options').then(({ data }) => setCurrentSemester(data.currentSemester || '')).catch(() => {}) }, [])

  async function signOut() {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      toast.error('Unable to sign out right now')
    }
  }

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    localStorage.setItem('campus-theme', next ? 'dark' : 'light')
  }

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><img className="sidebar-brand-logo" src="/logo.png" alt="" /><span className="sidebar-brand-name">Hormuud University<small>LEARNING MANAGEMENT SYSTEM</small></span><button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button></div>
        <div className="workspace-switch"><span className="workspace-emblem"><GraduationCap size={17} /></span><span><b>University workspace</b><small>{currentSemester || 'Academic workspace'}</small></span><ChevronDown size={14} /></div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {navigation[user.role].map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} end={!['Teachers', 'Students'].includes(label)} className={({ isActive }) => `side-link ${isActive ? 'side-link-active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Assignments' && <span className="nav-indicator" />}</NavLink>)}
        </nav>
        <div className="sidebar-bottom">{user.role !== 'admin' && <button className="side-link theme-toggle" onClick={toggleTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? 'Light appearance' : 'Dark appearance'}</span></button>}<div className="sidebar-user"><ProfileAvatar user={user} size="small" /><span className="user-meta"><b>{user.fullName}</b><small>{roleNames[user.role]}</small></span><button className="icon-button signout-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div></div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><span className="topbar-context">Workspace <span>/</span> <b>{pageNames[page] || 'Overview'}</b></span></div><div className="topbar-right"><span className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span><span className="topbar-divider" /><NotificationBell />{user.role === 'admin' ? <button className="icon-button topbar-theme-toggle" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button> : <button className="help-button" onClick={() => navigate('/app/messages?help=1')}><CircleHelp size={17} /><span>Help</span></button>}<ProfileAvatar user={user} size="small" className="topbar-avatar" /></div></header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><span>Hormuud University Learning Management System <span>·</span> Secure academic workspace</span><span>© 2026 Hormuud University</span></footer>
      </div>
    </div>
  )
}
