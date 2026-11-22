import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Clock3, LockKeyhole, Mail, MailCheck, XCircle } from 'lucide-react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import './AuthPage.css'

const RESEND_COOLDOWN_SECONDS = 60

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const params = useParams()
  // Links carry the token in the path (/verify-email/<token>); ?token= is still accepted for older emails.
  const token = params.token || searchParams.get('token') || ''
  const [status, setStatus] = useState(token ? 'verifying' : 'pending')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    // Keep the single-use token out of browser history once it has been read.
    window.history.replaceState(null, '', '/verify-email')
    api.post('/auth/verify-email', { token })
      .then(({ data }) => { setStatus('verified'); setMessage(data.message) })
      .catch((error) => {
        const result = error.response?.data?.status
        setStatus(result === 'expired' ? 'expired' : result === 'invalid' ? 'invalid' : 'error')
        setMessage(apiErrorMessage(error))
      })
  }, [token])

  const state = location.state || {}
  const content = {
    verifying: { icon: <Clock3 size={26} />, title: 'Verifying your email…', text: 'Please wait a moment.' },
    verified: { icon: <CheckCircle2 size={26} />, title: 'Email verified', text: message || 'Your email address is verified. You can now sign in.' },
    expired: { icon: <Clock3 size={26} />, title: 'Link expired', text: message },
    invalid: { icon: <XCircle size={26} />, title: 'Link not valid', text: message },
    error: { icon: <XCircle size={26} />, title: 'Verification failed', text: message },
    pending: {
      icon: <MailCheck size={26} />,
      title: 'Check your email',
      text: state.reason === 'login'
        ? 'Your email address has not been verified yet. Open the verification link we sent you, or request a new one below.'
        : state.emailSent === false
          ? 'Your account was created, but we could not send the verification email right now. Request a new one below.'
          : 'We sent a verification link to your email address. Open it to activate your student account, then sign in.',
    },
  }[status]

  return (
    <main className="auth-screen auth-screen-login">
      <header className="auth-topbar">
        <Link className="auth-wordmark" to="/" aria-label="Learning Management System home"><img className="auth-brand-logo" src="/logo.png" alt="" /><span>Hormuud University<small>LEARNING MANAGEMENT SYSTEM</small></span></Link>
        <div className="auth-switch-prompt">Already verified? <Link to="/login">Sign in<ArrowRight size={14} /></Link></div>
      </header>
      <section className="auth-stage" aria-labelledby="verify-title">
        <div className="auth-card verify-email-card" aria-live="polite">
          <div className="auth-login-card-heading">
            <span className={`verify-email-icon verify-email-${status}`}>{content.icon}</span>
            <h1 id="verify-title">{content.title}</h1>
            <p>{content.text}</p>
          </div>
          {status === 'verified' && <Link className="button-primary auth-submit" to="/login">Sign in to your account <ArrowRight size={17} /></Link>}
          {['pending', 'expired', 'invalid', 'error'].includes(status) && <ResendForm initialEmail={state.email || ''} />}
        </div>
        <div className="auth-trust-note"><LockKeyhole size={14} /><span>Verification links expire and can only be used once.</span></div>
      </section>
    </main>
  )
}

function ResendForm({ initialEmail }) {
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!cooldown) return undefined
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setNotice({ type: '', text: '' })
    try {
      const { data } = await api.post('/auth/resend-verification', { email })
      setNotice({ type: 'success', text: data.message })
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (error) {
      setNotice({ type: 'error', text: apiErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return <form className="auth-form auth-form-card verify-resend-form" onSubmit={submit}>
    <label className="auth-field"><span className="auth-field-label">Resend verification email</span><span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your registered email" /></span></label>
    {notice.text && <p role={notice.type === 'error' ? 'alert' : 'status'} className={notice.type === 'error' ? 'inline-error' : 'auth-form-hint'}>{notice.text}</p>}
    <button className="button-primary auth-submit" type="submit" disabled={busy || cooldown > 0}>{busy ? 'Sending…' : cooldown ? `Resend available in ${cooldown}s` : 'Send verification email'} {!busy && !cooldown && <ArrowRight size={17} />}</button>
  </form>
}
