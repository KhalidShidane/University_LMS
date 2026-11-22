import { useEffect, useRef, useState } from 'react'
import { FilePlus2, FileText, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'

const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp'
const MAX_FILES = 8
const MAX_BYTES = 10 * 1024 * 1024
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Dialog that uploads extra material files into an existing lesson (chapter). */
export default function AddLessonMaterials({ lesson, onClose, onUploaded }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const existing = lesson.materials?.length || 0
  const remaining = Math.max(0, 20 - existing)

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  function addFiles(list) {
    const incoming = [...list]
    const tooBig = incoming.filter((file) => file.size > MAX_BYTES)
    if (tooBig.length) toast.error(`${tooBig.map((file) => file.name).join(', ')}: files must be 10 MB or smaller`)
    const next = [...files, ...incoming.filter((file) => file.size <= MAX_BYTES && !files.some((item) => item.name === file.name && item.size === file.size))]
    const limit = Math.min(MAX_FILES, remaining)
    if (next.length > limit) toast.error(`You can add up to ${limit} file(s) here`)
    setFiles(next.slice(0, limit))
  }

  async function upload(event) {
    event.preventDefault()
    if (!files.length) return
    setBusy(true); setProgress(0)
    try {
      const body = new FormData()
      files.forEach((file) => body.append('files', file))
      await api.post(`/lessons/teacher/${lesson._id}/materials`, body, { onUploadProgress: (progressEvent) => setProgress(Math.round((progressEvent.loaded * 100) / (progressEvent.total || progressEvent.loaded))) })
      toast.success(`${files.length} material${files.length === 1 ? '' : 's'} added to ${lesson.title}`)
      onUploaded()
      onClose()
    } catch (error) {
      toast.error(apiErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="panel add-materials-dialog" role="dialog" aria-modal="true" aria-labelledby="add-materials-title">
      <div className="panel-heading"><div><h2 id="add-materials-title">Add materials</h2><p>Upload more files to <b>{lesson.title}</b>. {existing} file{existing === 1 ? '' : 's'} already in this lesson.</p></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></div>
      <form onSubmit={upload} className="add-materials-form">
        {remaining === 0 ? <p className="inline-error">This lesson already has the maximum of 20 materials. Remove one before adding more.</p> : <>
          <button type="button" className={`add-materials-drop ${dragging ? 'is-dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
            <Upload size={22} /><b>Choose files or drag them here</b><small>PDF, Word, PowerPoint, Excel, or images · up to 10 MB each · {Math.min(MAX_FILES, remaining)} at a time</small>
          </button>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
        </>}
        {files.length > 0 && <ul className="add-materials-list">{files.map((file) => <li key={`${file.name}-${file.size}`}><FileText size={16} /><span>{file.name}</span><small>{size(file.size)}</small><button type="button" className="icon-button" disabled={busy} onClick={() => setFiles(files.filter((item) => item !== file))} aria-label={`Remove ${file.name}`}><X size={14} /></button></li>)}</ul>}
        {busy && <div className="add-materials-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
        {lesson.status === 'published' && <p className="add-materials-hint">This lesson is published: students can download the new files right away.</p>}
        <div className="add-materials-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button-primary" disabled={busy || !files.length}><FilePlus2 size={16} />{busy ? `Uploading ${progress}%` : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}</button></div>
      </form>
    </section>
  </div>
}
