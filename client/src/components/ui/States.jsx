import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'

export function LoadingScreen({ label = 'Loading' }) {
  return <div className="loading-screen"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>
}

export function PageLoading() {
  return <div className="page-loading"><span /><span /><span /></div>
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={20} /></span><strong>{title}</strong><p>{description}</p>{action}</div>
}

export function ErrorState({ message = 'Something went wrong', onRetry }) {
  return <div className="error-state"><AlertCircle size={19} /><span>{message}</span>{onRetry && <button className="button-quiet" onClick={onRetry}>Try again</button>}</div>
}
