import { useState } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { apiErrorMessage } from '../../services/api.js'
import './AuthPage.css'

/** Second sign-in step for accounts with two-step verification. */
export default function TwoFactorLoginStep({ challengeToken, completeTwoFactor, onSignedIn, onCancel }) {
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await completeTwoFactor({ challengeToken, code })
      if (result.recoveryCodesLeft !== undefined) toast(`Recovery code used. ${result.recoveryCodesLeft} left. Create new codes in your profile.`, { icon: '🔑', duration: 7000 })
      onSignedIn(result.user)
    } catch (requestError) {
      const errorCode = requestError.response?.data?.code
      if (errorCode === 'CHALLENGE_EXPIRED' || errorCode === 'ACCOUNT_LOCKED') { toast.error(apiErrorMessage(requestError)); onCancel(); return }
      setError(apiErrorMessage(requestError))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen auth-screen-login">
    <header className="auth-topbar">
      <Link className="auth-wordmark" to="/" aria-label="Learning Management System home"><img className="auth-brand-logo" src="/logo.png" alt="" /><span>Hormuud University<small>LEARNING MANAGEMENT SYSTEM</small></span></Link>
    </header>
    <section className="auth-stage" aria-labelledby="two-factor-title">
      <div className="auth-card verify-email-card">
        <div className="auth-login-card-heading">
          <span className="verify-email-icon">{useRecovery ? <KeyRound size={26} /> : <ShieldCheck size={26} />}</span>
          <h1 id="two-factor-title">Two-step verification</h1>
          <p>{useRecovery ? 'Enter one of the recovery codes you saved when you turned on two-step verification.' : 'Open your authenticator app and enter the 6-digit code for DARSIVO LMS.'}</p>
        </div>
        <form className="auth-form auth-form-card" onSubmit={submit}>
          <label className="auth-field"><span className="auth-field-label">{useRecovery ? 'Recovery code' : 'Authentication code'}</span>
            <span className="auth-input-wrap"><LockKeyhole size={17} />
              {useRecovery
                ? <input key="recovery" autoFocus required autoComplete="one-time-code" maxLength={9} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX" />
                : <input key="totp" autoFocus required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} className="two-factor-code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="123456" />}
            </span>
          </label>
          {error && <p role="alert" className="inline-error">{error}</p>}
          <button className="button-primary auth-submit" type="submit" disabled={busy || (useRecovery ? code.length < 8 : code.length !== 6)}>{busy ? 'Checking…' : 'Verify and sign in'} {!busy && <ArrowRight size={17} />}</button>
          <button type="button" className="button-quiet two-factor-switch" onClick={() => { setUseRecovery((value) => !value); setCode(''); setError('') }}>{useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}</button>
          <button type="button" className="button-quiet two-factor-switch" onClick={onCancel}><ArrowLeft size={14} /> Back to sign in</button>
        </form>
      </div>
      <div className="auth-trust-note"><ShieldCheck size={14} /><span>Two-step verification protects your account even if your password is known.</span></div>
    </section>
  </main>
}
