import { useEffect, useRef, useState } from 'react'
import TwoFactorPanel from '../components/common/TwoFactorPanel.jsx'
import { Camera, ImagePlus, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import api, { apiErrorMessage } from '../services/api.js'
import ProfileAvatar from '../components/common/ProfileAvatar.jsx'
import { compressImage } from '../utils/compressImage.js'
import EmailPreferencesPanel from '../components/common/EmailPreferencesPanel.jsx'

const roles = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' }

export default function ProfilePage() {
  const { user, refresh } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [fullName, setFullName] = useState(user.fullName || '')
  const [savingName, setSavingName] = useState(false)

  useEffect(() => setFullName(user.fullName || ''), [user.fullName])

  useEffect(() => {
    if (!selectedPhoto) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(selectedPhoto)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedPhoto])

  function choosePhoto(file) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Choose a JPEG, PNG, or WebP image')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Choose an image smaller than 15 MB so it can be compressed')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    compressImage(file).then(setSelectedPhoto).catch((error) => toast.error(error.message))
  }

  function cancelPhoto() {
    setSelectedPhoto(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function savePhoto() {
    if (!selectedPhoto) return
    const body = new FormData()
    body.append('photo', selectedPhoto)
    setBusy(true)
    try {
      await api.post('/profile/photo', body)
      await refresh()
      cancelPhoto()
      toast.success('Profile photo updated')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    setBusy(true)
    try {
      await api.delete('/profile/photo')
      await refresh()
      toast.success('Profile photo removed')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveName(event) {
    event.preventDefault()
    const nextName = fullName.trim()
    if (!nextName) {
      toast.error('Name is required')
      return
    }
    setSavingName(true)
    try {
      await api.patch('/profile', { fullName: nextName })
      await refresh()
      setEditingName(false)
      toast.success('Name updated')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    } finally {
      setSavingName(false)
    }
  }

  return <>
    <div className="section-title-row"><div><div className="section-kicker">ACCOUNT SETTINGS</div><h1>My profile</h1><p>Manage the profile photo shown across your university workspace.</p></div></div>
    <div className="profile-page-grid">
      <section className="panel profile-photo-panel">
        <div className="panel-heading"><div><h2>Profile photo</h2><p>Use a clear photo so your classmates and colleagues can recognize you.</p></div><Camera size={18} className="panel-heading-icon" /></div>
        <div className="profile-preview"><ProfileAvatar user={user} size="large" /><div className="profile-preview-info"><b>{user.fullName}</b><span>{roles[user.role]}</span><small>{user.email}</small></div></div>
        <div className="profile-name-editor">
          {editingName ? <form className="profile-name-form" onSubmit={saveName}><label htmlFor="profile-full-name">Full name</label><input id="profile-full-name" autoComplete="name" required maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} /><div className="profile-photo-actions"><button className="button-primary" type="submit" disabled={savingName}>{savingName ? 'Saving…' : 'Save name'}</button><button className="button-secondary" type="button" disabled={savingName} onClick={() => { setFullName(user.fullName || ''); setEditingName(false) }}>Cancel</button></div></form> : <button className="button-secondary profile-name-change" onClick={() => setEditingName(true)}><Pencil size={14} />Change name</button>}
        </div>
        {selectedPhoto && <div className="profile-pending-preview"><img src={previewUrl} alt="Preview of the new profile photo" /><div><b>New photo preview</b><span>Not saved yet. Your current profile photo is still active.</span></div></div>}
        <input ref={inputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event.target.files?.[0])} />
        <div className="profile-photo-actions">
          {selectedPhoto ? <>
            <button className="button-primary" onClick={savePhoto} disabled={busy}><ImagePlus size={16} />{busy ? 'Saving…' : 'Save new photo'}</button>
            <button className="button-secondary" onClick={() => inputRef.current?.click()} disabled={busy}><ImagePlus size={15} />Choose different photo</button>
            <button className="button-quiet" onClick={cancelPhoto} disabled={busy}>Cancel</button>
          </> : <>
            <button className="button-primary" onClick={() => inputRef.current?.click()} disabled={busy}><ImagePlus size={16} />{user.profileImage ? 'Change photo' : 'Upload photo'}</button>
            {user.profileImage && <button className="button-secondary" onClick={removePhoto} disabled={busy}><Trash2 size={15} />Remove photo</button>}
          </>}
        </div>
        <p className="profile-photo-note">JPEG, PNG, or WebP · Compressed to 1 MB or less · Only signed-in university users can view profile photos.</p>
      </section>
      <section className="panel profile-details-panel"><div className="panel-heading"><div><h2>Account details</h2><p>Your identity and academic access</p></div></div><dl className="profile-details"><div><dt>Full name</dt><dd>{user.fullName}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Account role</dt><dd><span className={`role-pill role-${user.role}`}>{roles[user.role]}</span></dd></div>{user.studentId && <div><dt>Student ID</dt><dd>{user.studentId}</dd></div>}{user.class && <div><dt>Class</dt><dd>{typeof user.class === 'string' ? 'Assigned academic class' : user.class.name}</dd></div>}{user.department && <div><dt>Department</dt><dd>{typeof user.department === 'string' ? 'Assigned department' : user.department.name}</dd></div>}</dl></section>
    </div>
    <TwoFactorPanel />
    {user.role === 'student' && <EmailPreferencesPanel />}
  </>
}
