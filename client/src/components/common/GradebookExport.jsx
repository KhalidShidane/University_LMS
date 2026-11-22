import { useEffect, useState } from 'react'
import { FileSpreadsheet, ListChecks, UserX, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { saveBlob } from '../../utils/download.js'
import './GradebookExport.css'

const WORDS = {
  quizzes: { one: 'quiz', many: 'quizzes', title: 'Quizzes' },
  assignments: { one: 'assignment', many: 'assignments', title: 'Assignments' },
}

/**
 * Button + dialog for one kind of work (quizzes OR assignments, never mixed).
 * The teacher picks a class, then all items or a single one, then marks or the not-submitted list.
 */
export default function GradebookExport({ type }) {
  const words = WORDS[type]
  const [open, setOpen] = useState(false)
  const [classes, setClasses] = useState(null)
  const [classId, setClassId] = useState('')
  const [items, setItems] = useState(null)
  const [itemId, setItemId] = useState('')
  const [report, setReport] = useState('marks')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || classes) return
    api.get('/teacher/classes')
      .then(({ data }) => { setClasses(data.classes || []); if (data.classes?.length === 1) setClassId(data.classes[0]._id) })
      .catch((error) => { setClasses([]); toast.error(apiErrorMessage(error)) })
  }, [open, classes])

  useEffect(() => {
    setItems(null); setItemId('')
    if (!open || !classId) return
    api.get(`/teacher/gradebook/${classId}/items`, { params: { type } })
      .then(({ data }) => setItems(data.items || []))
      .catch((error) => { setItems([]); toast.error(apiErrorMessage(error)) })
  }, [open, classId, type])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function download(event) {
    event.preventDefault()
    if (!classId) return
    setBusy(true)
    try {
      const response = await api.get(`/teacher/gradebook/${classId}/export`, { params: { type, report, ...(itemId ? { itemId } : {}) }, responseType: 'blob' })
      saveBlob(response, `${words.many}.xlsx`)
      toast.success('Excel file downloaded')
      setOpen(false)
    } catch (error) {
      toast.error(await blobErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const chosen = items?.find((item) => item.id === itemId)
  const subject = chosen ? `${chosen.code}: ${chosen.title}` : `all ${words.many}`
  const reports = [
    ['marks', ListChecks, 'Marks', chosen ? `Every student with their mark for this ${words.one}.` : `Every student with a column per ${words.one} and their marks.`],
    ['missing', UserX, 'Not submitted', chosen ? `Only the students who did not submit this ${words.one}.` : `Only the students who did not submit, listed per ${words.one}.`],
  ]

  return <>
    <button type="button" className="button-secondary gradebook-export-trigger" onClick={() => setOpen(true)}><FileSpreadsheet size={16} /> Export {words.many} (Excel)</button>
    {open && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="panel gradebook-export-dialog" role="dialog" aria-modal="true" aria-labelledby="gradebook-export-title">
        <div className="panel-heading"><div><h2 id="gradebook-export-title">Export {words.many} to Excel</h2><p>Choose a class, then all {words.many} or a single {words.one}.</p></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></div>
        <form onSubmit={download} className="gradebook-export-form">
          <label>Class
            <select required value={classId} onChange={(event) => setClassId(event.target.value)} disabled={!classes}>
              <option value="">{classes ? (classes.length ? 'Choose a class' : 'No classes assigned') : 'Loading classes…'}</option>
              {(classes || []).map((item) => <option key={item._id} value={item._id}>{item.classCode && item.classCode !== item.name ? `${item.classCode} · ` : ''}{item.name} ({item.studentsCount} students)</option>)}
            </select>
          </label>
          <label>{words.title}
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={!classId || !items || !items.length}>
              <option value="">{!classId ? 'Choose a class first' : !items ? `Loading ${words.many}…` : items.length ? `All ${words.many} (${items.length})` : `No published ${words.many} in this class`}</option>
              {(items || []).map((item) => <option key={item.id} value={item.id}>{item.code}: {item.title}</option>)}
            </select>
          </label>
          <fieldset className="gradebook-export-types"><legend>Download</legend>
            {reports.map(([value, Icon, label, hint]) => <label key={value} className={`gradebook-type-option ${report === value ? 'is-selected' : ''}`}><input type="radio" name="gradebook-report" value={value} checked={report === value} onChange={() => setReport(value)} /><Icon size={17} className="gradebook-type-icon" /><span><b>{label}</b><small>{hint}</small></span></label>)}
          </fieldset>
          <p className="gradebook-export-summary">You will download: <b>{report === 'missing' ? 'students who did not submit' : 'marks'}</b> for <b>{subject}</b>.</p>
          <div className="gradebook-export-actions"><button type="button" className="button-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button-primary" disabled={busy || !classId || !items?.length}><FileSpreadsheet size={16} />{busy ? 'Preparing…' : 'Download Excel'}</button></div>
        </form>
      </section>
    </div>}
  </>
}

async function blobErrorMessage(error) {
  try {
    const text = await error.response?.data?.text?.()
    if (text) return JSON.parse(text).message || 'Download failed'
  } catch { /* fall through */ }
  return apiErrorMessage(error)
}
