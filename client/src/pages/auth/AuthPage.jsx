import { useEffect, useState } from 'react'
import { ArrowRight, BookOpenCheck, Building2, Eye, EyeOff, Hash, LockKeyhole, Mail, School, UserRound } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext.jsx'
import api, { apiErrorMessage } from '../../services/api.js'
import { PageLoading } from '../../components/ui/States.jsx'
import './AuthPage.css'

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { login, registerStudent } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [options, setOptions] = useState(null)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', studentId: '', faculty: '', department: '', class: '' })

  useEffect(() => {
    if (!isRegister) return
    api.get('/academic/options').then(({ data }) => setOptions(data)).catch(() => setOptions({ classes: [], departments: [], faculties: [] }))
  }, [isRegister])

  function update(field, value) {
    setForm((current) => field === 'faculty'
      ? { ...current, faculty: value, department: '', class: '' }
      : field === 'department'
        ? { ...current, department: value, class: '' }
        : { ...current, [field]: value })
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      if (isRegister) {
        await registerStudent(form)
        toast.success('Your student workspace is ready')
        navigate('/app/dashboard', { replace: true })
      } else {
        const user = await login({ email: form.email, password: form.password })
        toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`)
        navigate(location.state?.from?.pathname || '/app/dashboard', { replace: true })
      }
    } catch (error) {
      toast.error(apiErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const classes = options?.classes || []
  const departments = (options?.departments || []).filter((item) => String(item.faculty) === form.faculty)
  const availableClasses = classes.filter((item) => String(item.department) === form.department)

  return (
    <main className={`auth-screen ${isRegister ? 'auth-screen-register' : 'auth-screen-login'}`}>
      <header className="auth-topbar">
        <Link className="auth-wordmark" to="/" aria-label="Hormuud University Learning Management System home"><img className="auth-brand-logo" src="/logo.png" alt="" /><span>Hormuud University<small>LEARNING MANAGEMENT SYSTEM</small></span></Link>
        <div className="auth-switch-prompt">{isRegister ? 'Already have an account?' : 'New to your class?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create account'}<ArrowRight size={14} /></Link></div>
      </header>

      <section className="auth-stage" aria-labelledby="auth-title">
        {isRegister && <><div className="auth-emblem"><BookOpenCheck size={25} strokeWidth={1.9} /></div>
        <div className="auth-heading auth-heading-centered">
          <span className="auth-kicker">{isRegister ? 'STUDENT ACCESS' : 'HORMUUD UNIVERSITY · LEARNING MANAGEMENT SYSTEM'}</span>
          <h1 id="auth-title">Start your learning journey</h1>
          <p>{isRegister ? 'Create your student account and get instant access to your class.' : 'Sign in with your university account to continue learning.'}</p>
        </div></>}

        <div className="auth-card">
          {!isRegister && <div className="auth-login-card-heading"><span className="auth-login-emblem"><img src="/logo.png" alt="Hormuud University logo" /></span><h1 id="auth-title">Sign in to your account</h1><p>Use your university email to continue to your classes and coursework.</p></div>}
          {isRegister && !options ? <div className="auth-loading"><PageLoading /></div> : <form className="auth-form auth-form-card" onSubmit={submit}>
            {isRegister && <label className="auth-field register-name-field">Full name<span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" required maxLength={160} value={form.fullName} onChange={(event) => update('fullName', event.target.value)} placeholder="Enter your full name" /></span></label>}
            <label className={`auth-field ${isRegister ? 'register-email-field' : ''}`}><span className={isRegister ? 'auth-field-label' : 'auth-visually-hidden'}>University email</span><span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => update('email', event.target.value)} placeholder={isRegister ? 'name@university.edu' : 'Email'} /></span></label>
            {isRegister && <label className="auth-field register-id-field">Student ID<span className="auth-input-wrap"><Hash size={17} /><input required maxLength={40} value={form.studentId} onChange={(event) => update('studentId', event.target.value)} placeholder="e.g. STU-20418" /></span></label>}
            {isRegister && <div className="auth-field-row"><label className="auth-field">Faculty<span className="auth-select-wrap"><Building2 size={16} /><select required value={form.faculty} onChange={(event) => update('faculty', event.target.value)}><option value="">Choose faculty</option>{(options?.faculties || []).map((item) => <option key={item._id} value={item._id}>{item.name} · {item.code}</option>)}</select></span></label><label className="auth-field">Department<span className="auth-select-wrap"><Building2 size={16} /><select required value={form.department} onChange={(event) => update('department', event.target.value)} disabled={!form.faculty}><option value="">Choose department</option>{departments.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.code}</option>)}</select></span></label></div>}
            {isRegister && <label className="auth-field register-class-field">Academic class<span className="auth-select-wrap"><School size={17} /><select required value={form.class} onChange={(event) => update('class', event.target.value)} disabled={!form.department}><option value="">Choose your class</option>{availableClasses.map((item) => <option key={item._id} value={item._id}>{item.classCode} · {item.name}</option>)}</select></span></label>}
            <label className={`auth-field ${isRegister ? 'register-password-field' : ''}`}><span className="auth-password-label">Password{!isRegister && <span className="auth-password-hint"><LockKeyhole size={13} /> Protected sign-in</span>}</span><span className="auth-input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={isRegister ? '8–72 characters' : 'Enter your password'} /><button type="button" className="password-reveal" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            {isRegister && classes.length === 0 && <p className="auth-form-hint">No active classes are open for registration yet. Contact your university administrator.</p>}
            <button className="button-primary auth-submit" type="submit" disabled={busy || (isRegister && (classes.length === 0 || !form.class))}>{busy ? 'Please wait…' : isRegister ? 'Create student account' : 'Sign in to your account'} {!busy && <ArrowRight size={17} />}</button>
            {isRegister && <p className="consent-note">Your student account is ready as soon as registration is complete.</p>}
          </form>}
        </div>
        <div className="auth-trust-note"><LockKeyhole size={14} /><span>Your account and academic information are protected.</span></div>
      </section>

      <footer className="auth-footer"><span>Hormuud University Learning Management System <i /> Secure university access</span><span>© {new Date().getFullYear()} Hormuud University</span></footer>
    </main>
  )
}
