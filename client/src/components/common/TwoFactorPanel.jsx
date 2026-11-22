import { useEffect, useState } from 'react'
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import './TwoFactorPanel.css'

function RecoveryCodes({ codes, onDone }) {
  const text = codes.join('\n')
  const copy = () => navigator.clipboard?.writeText(text).then(() => toast.success('Recovery codes copied')).catch(() => toast.error('Copy failed; write them down instead'))
  const download = () => {
    const url = URL.createObjectURL(new Blob([`DARSIVO LMS recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`], { type: 'text/plain' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'darsivo-recovery-codes.txt' })
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="two-factor-codes">
    <p><b>Save these recovery codes now.</b> Each one signs you in once if you lose your phone. They will not be shown again.</p>
    <ol>{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
    <div className="two-factor-actions"><button type="button" className="button-secondary" onClick={copy}><Copy size={15} /> Copy</button><button type="button" className="button-secondary" onClick={download}><Download size={15} /> Download</button><button type="button" className="button-primary" onClick={onDone}>I saved them</button></div>
  </div>
}

/** Profile section: turn two-step verification (authenticator app) on or off. */
export default function TwoFactorPanel() {
  const [status, setStatus] = useState(null)
  const [setup, setSetup] = useState(null)
  const [codes, setCodes] = useState(null)
  const [mode, setMode] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/auth/2fa').then(({ data }) => setStatus(data)).catch((error) => toast.error(apiErrorMessage(error)))
  useEffect(() => { load() }, [])
  const reset = () => { setSetup(null); setMode(''); setCode(''); setPassword('') }

  async function run(action) {
    setBusy(true)
    try { await action() } catch (error) { toast.error(apiErrorMessage(error)) } finally { setBusy(false) }
  }
  const start = () => run(async () => { const { data } = await api.post('/auth/2fa/setup'); setSetup(data); setMode('enable') })
  const enable = (event) => { event.preventDefault(); run(async () => { const { data } = await api.post('/auth/2fa/enable', { code }); reset(); setCodes(data.recoveryCodes); toast.success('Two-step verification is on'); await load() }) }
  const disable = (event) => { event.preventDefault(); run(async () => { await api.post('/auth/2fa/disable', { password, code }); reset(); toast.success('Two-step verification is off'); await load() }) }
  const regenerate = (event) => { event.preventDefault(); run(async () => { const { data } = await api.post('/auth/2fa/recovery-codes', { code }); reset(); setCodes(data.recoveryCodes); await load() }) }

  return <section className="panel two-factor-panel">
    <div className="panel-heading"><div><h2>Two-step verification {status?.recommended && !status.enabled && <span className="status-pill status-warning">Recommended</span>}</h2><p>Sign in with your password and a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy).</p></div><ShieldCheck size={18} className="panel-heading-icon" /></div>
    {!status ? <p className="two-factor-muted">Loading…</p> : codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : <>
      <div className={`two-factor-state ${status.enabled ? 'is-on' : ''}`}>{status.enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}<div><b>{status.enabled ? 'On' : 'Off'}</b><small>{status.enabled ? `Turned on ${status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : ''} · ${status.recoveryCodesLeft} recovery code${status.recoveryCodesLeft === 1 ? '' : 's'} left` : 'Your account is protected by your password only.'}</small></div></div>

      {!status.enabled && mode !== 'enable' && <button type="button" className="button-primary" onClick={start} disabled={busy}><ShieldCheck size={16} /> Turn on two-step verification</button>}

      {mode === 'enable' && setup && <form className="two-factor-setup" onSubmit={enable}>
        <ol className="two-factor-steps">
          <li>Install an authenticator app on your phone.</li>
          <li>Scan this QR code with the app (or type the key).</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="two-factor-qr"><img src={setup.qrDataUrl} alt="QR code for your authenticator app" width="180" height="180" /><div><small>Setup key</small><code>{setup.secret}</code></div></div>
        <label>Code from the app<input required autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" className="two-factor-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="123456" /></label>
        <div className="two-factor-actions"><button type="button" className="button-secondary" onClick={reset} disabled={busy}>Cancel</button><button className="button-primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify and turn on'}</button></div>
      </form>}

      {status.enabled && !mode && <div className="two-factor-actions"><button type="button" className="button-secondary" onClick={() => setMode('recovery')}><KeyRound size={15} /> New recovery codes</button><button type="button" className="button-secondary danger-text" onClick={() => setMode('disable')}><ShieldOff size={15} /> Turn off</button></div>}

      {mode === 'recovery' && <form className="two-factor-setup" onSubmit={regenerate}>
        <label>Current code from your app<input required autoFocus inputMode="numeric" maxLength={9} className="two-factor-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="123456" /></label>
        <p className="two-factor-muted">Your old recovery codes stop working.</p>
        <div className="two-factor-actions"><button type="button" className="button-secondary" onClick={reset} disabled={busy}>Cancel</button><button className="button-primary" disabled={busy || code.length < 6}>Create new codes</button></div>
      </form>}

      {mode === 'disable' && <form className="two-factor-setup" onSubmit={disable}>
        <label>Your password<input type="password" required autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Code from your app (or a recovery code)<input required inputMode="numeric" maxLength={9} className="two-factor-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="123456" /></label>
        <div className="two-factor-actions"><button type="button" className="button-secondary" onClick={reset} disabled={busy}>Cancel</button><button className="button-primary" disabled={busy || !password || code.length < 6}>Turn off</button></div>
      </form>}
    </>}
  </section>
}
