import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, MailCheck, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import api, { apiErrorMessage } from '../../services/api.js'
import './AuthPage.css'

function AuthShell({ children, title, text, icon, tone = '' }) {
  return <main className="auth-screen auth-screen-login">
    <header className="auth-topbar">
      <Link className="auth-wordmark" to="/" aria-label="Learning Management System home"><img className="auth-brand-logo" src="/logo.png" alt="" /><span>Hormuud University<small>LEARNING MANAGEMENT SYSTEM</small></span></Link>
      <div className="auth-switch-prompt">Remembered it? <Link to="/login">Sign in<ArrowRight size={14} /></Link></div>
    </header>
    <section className="auth-stage" aria-labelledby="reset-title">
      <div className="auth-card verify-email-card" aria-live="polite">
        <div className="auth-login-card-heading"><span className={`verify-email-icon ${tone}`}>{icon}</span><h1 id="reset-title">{title}</h1><p>{text}</p></div>
        {children}
      </div>
      <div className="auth-trust-note"><LockKeyhole size={14} /><span>Reset links expire after one hour and work only once.</span></div>
    </section>
  </main>
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { data } = await api.post('/auth/forgot-password', { email })
      setSent(data.message)
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return <AuthShell icon={<MailCheck size={26} />} title="Check your email" text={sent}>
      <Link className="button-secondary auth-submit" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>
    </AuthShell>
  }
  return <AuthShell icon={<KeyRound size={26} />} title="Forgot your password?" text="Enter your account email and we will send you a link to choose a new password.">
    <form className="auth-form auth-form-card" onSubmit={submit}>
      <label className="auth-field"><span className="auth-field-label">Email</span><span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@university.edu" /></span></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'} {!busy && <ArrowRight size={17} />}</button>
    </form>
  </AuthShell>
}

export function ResetPasswordPage() {
  const params = useParams()
  const token = useRef(params.token || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // Keep the single-use token out of browser history.
  useEffect(() => { if (params.token) window.history.replaceState(null, '', '/reset-password') }, [params.token])

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password

  async function submit(event) {
    event.preventDefault()
    if (password.length < 8 || password !== confirm) return
    setBusy(true)
    try {
      const { data } = await api.post('/auth/reset-password', { token: token.current, password })
      setResult({ ok: true, message: data.message })
    } catch (requestError) {
      setResult({ ok: false, message: apiErrorMessage(requestError) })
    } finally {
      setBusy(false)
    }
  }

  if (!token.current) {
    return <AuthShell icon={<XCircle size={26} />} tone="verify-email-invalid" title="Link not valid" text="Open the reset link from your email, or request a new one.">
      <Link className="button-primary auth-submit" to="/forgot-password">Request a new link <ArrowRight size={17} /></Link>
    </AuthShell>
  }
  if (result?.ok) {
    return <AuthShell icon={<CheckCircle2 size={26} />} tone="verify-email-verified" title="Password changed" text={result.message}>
      <Link className="button-primary auth-submit" to="/login">Sign in <ArrowRight size={17} /></Link>
    </AuthShell>
  }
  if (result && !result.ok) {
    return <AuthShell icon={<XCircle size={26} />} tone="verify-email-invalid" title="Could not reset password" text={result.message}>
      <Link className="button-primary auth-submit" to="/forgot-password">Request a new link <ArrowRight size={17} /></Link>
    </AuthShell>
  }
  return <AuthShell icon={<KeyRound size={26} />} title="Choose a new password" text="Use at least 8 characters. You will be signed out of all other devices.">
    <form className="auth-form auth-form-card" onSubmit={submit}>
      <label className="auth-field"><span className="auth-field-label">New password</span><span className="auth-input-wrap"><LockKeyhole size={17} /><input type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8–72 characters" /><button type="button" className="password-reveal" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
      <label className="auth-field"><span className="auth-field-label">Confirm new password</span><span className="auth-input-wrap"><LockKeyhole size={17} /><input type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Type it again" /></span></label>
      {(tooShort || mismatch) && <p role="alert" className="inline-error">{tooShort ? 'Use at least 8 characters.' : 'The passwords do not match.'}</p>}
      <button className="button-primary auth-submit" type="submit" disabled={busy || password.length < 8 || password !== confirm}>{busy ? 'Saving…' : 'Change password'} {!busy && <ArrowRight size={17} />}</button>
    </form>
  </AuthShell>
}
