import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Check, CloudOff, Download, ExternalLink, LoaderCircle, Maximize2, Minimize2, PanelRightClose, RotateCcw, Save, SlidersHorizontal, Trash2, TriangleAlert, X } from 'lucide-react'
import api, { apiErrorMessage } from '../../services/api.js'
import { saveBlob } from '../../utils/download.js'
import RichTextEditor from './RichTextEditor.jsx'
import useNoteSaver from './useNoteSaver.js'
import { NOTE_COLORS, clearBackup, lessonPath, notesApi, readBackup, relativeTime } from './noteUtils.js'

function SaveStatus({ status, errorMessage, updatedAt }) {
  if (status === 'saving') return <span className="note-save-status is-saving" role="status"><LoaderCircle size={13} className="spin" /> Saving…</span>
  if (status === 'pending') return <span className="note-save-status is-warning" role="status">Unsaved changes</span>
  if (status === 'offline') return <span className="note-save-status is-warning" role="status" title={errorMessage}><CloudOff size={13} /> Offline · not saved</span>
  if (status === 'error') return <span className="note-save-status is-error" role="alert" title={errorMessage}><TriangleAlert size={13} /> Not saved</span>
  if (status === 'conflict') return <span className="note-save-status is-error" role="alert"><TriangleAlert size={13} /> Version conflict</span>
  return <span className="note-save-status is-saved" role="status" title={updatedAt ? `Saved ${new Date(updatedAt).toLocaleString()}` : undefined}><Check size={13} /> Saved</span>
}

function TagInput({ tags, onChange }) {
  const [value, setValue] = useState('')
  const add = (raw) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 40)
    if (!tag || tags.includes(tag)) { setValue(''); return }
    if (tags.length >= 20) { toast.error('Add no more than 20 tags'); return }
    onChange([...tags, tag]); setValue('')
  }
  return <div className="note-tag-input">
    {tags.map((tag) => <span className="note-tag-chip is-removable" key={tag}>#{tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}><X size={11} /></button></span>)}
    <input value={value} placeholder={tags.length ? 'Add tag' : 'Add tags (press Enter)'} aria-label="Add tag" maxLength={41}
      onChange={(event) => { const next = event.target.value; if (next.endsWith(',')) add(next.slice(0, -1)); else setValue(next) }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(value) } else if (event.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1)) }}
      onBlur={() => value.trim() && add(value)} />
  </div>
}

function LinkPicker({ courseId, lessonId, onChange }) {
  const [courses, setCourses] = useState(null)
  const [lessons, setLessons] = useState({})
  useEffect(() => { api.get('/student/courses').then(({ data }) => setCourses(data.courses || [])).catch(() => setCourses([])) }, [])
  useEffect(() => {
    if (!courseId || lessons[courseId]) return
    api.get(`/student/courses/${courseId}/lessons`).then(({ data }) => setLessons((current) => ({ ...current, [courseId]: data.lessons || [] }))).catch(() => setLessons((current) => ({ ...current, [courseId]: [] })))
  }, [courseId])
  const courseLessons = courseId ? lessons[courseId] : []
  return <div className="note-link-picker">
    <label><span>Course</span><select value={courseId || ''} onChange={(event) => onChange(event.target.value || null, null)} disabled={!courses}>
      <option value="">General note (no course)</option>
      {courseId && courses && !courses.some((course) => course._id === courseId) && <option value={courseId}>Current course</option>}
      {(courses || []).map((course) => <option key={course._id} value={course._id}>{course.courseCode ? `${course.courseCode} · ` : ''}{course.name}</option>)}
    </select></label>
    <label><span>Lesson</span><select value={lessonId || ''} onChange={(event) => onChange(courseId, event.target.value || null)} disabled={!courseId || !courseLessons}>
      <option value="">{courseId ? 'Whole course' : '—'}</option>
      {lessonId && courseLessons && !courseLessons.some((lesson) => lesson._id === lessonId) && <option value={lessonId}>Current lesson</option>}
      {(courseLessons || []).map((lesson) => <option key={lesson._id} value={lesson._id}>{lesson.title}</option>)}
    </select></label>
  </div>
}

/**
 * Full note editor used by both the lesson side panel and the My Notes page.
 */
export default function NoteDetail({ noteId, userId, onBack, onClose, onSaved, onDeleted, expanded, onToggleExpand, showLessonLink = false, detailsOpenByDefault = false }) {
  const [note, setNote] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState(null)
  const [editorKey, setEditorKey] = useState(0)
  const [conflictNote, setConflictNote] = useState(null)
  const [backup, setBackup] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(detailsOpenByDefault)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  async function load() {
    setLoadError(''); setNote(null); setDraft(null); setConflictNote(null)
    try {
      const loaded = await notesApi.get(noteId)
      setNote(loaded)
      setDraft({ title: loaded.title, color: loaded.color, tags: loaded.tags, content: loaded.content, course: loaded.course?._id || null, lesson: loaded.lesson?._id || null })
      setEditorKey((key) => key + 1)
      const stored = readBackup(userId, noteId)
      setBackup(stored?.changes && Object.keys(stored.changes).length ? stored : null)
    } catch (error) { setLoadError(apiErrorMessage(error)) }
  }
  useEffect(() => { load() }, [noteId])

  const saver = useNoteSaver({
    note,
    userId,
    onSaved: (saved) => {
      setNote((current) => ({ ...current, ...saved }))
      onSavedRef.current?.(saved)
    },
    onConflict: (serverNote) => setConflictNote(serverNote),
  })

  const change = (fields) => {
    setDraft((current) => ({ ...current, ...fields }))
    saver.queueChange(fields)
  }

  async function saveNow() {
    if (!saver.hasUnsaved()) return
    // Failures are shown by the status label and banners; success gets a short confirmation.
    if (await saver.save()) toast.success('Note saved', { id: 'note-saved' })
  }

  // Leaving the note: warn about unsaved edits, and drop a brand-new note that was never written in.
  function leave(next) {
    if (saver.hasUnsaved()) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) return
      saver.discardPending()
    }
    if (note && note.version === 1 && !note.title && !note.wordCount) {
      notesApi.remove(note._id).then(() => onDeleted?.(note._id)).catch(() => {})
    }
    next()
  }

  function onKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNow() }
  }

  function restoreBackup() {
    const { changes } = backup
    setDraft((current) => ({ ...current, ...changes }))
    if (changes.content) setEditorKey((key) => key + 1)
    saver.queueChange(changes)
    setBackup(null)
    toast.success('Unsaved changes restored')
  }
  function discardBackup() { clearBackup(userId, noteId); setBackup(null) }

  function keepMine() { const serverNote = conflictNote; setConflictNote(null); saver.keepMine(serverNote) }
  function useSaved() {
    const serverNote = conflictNote
    saver.discardPending(serverNote)
    setConflictNote(null)
    setNote(serverNote)
    setDraft({ title: serverNote.title, color: serverNote.color, tags: serverNote.tags, content: serverNote.content, course: serverNote.course?._id || null, lesson: serverNote.lesson?._id || null })
    setEditorKey((key) => key + 1)
    onSavedRef.current?.(serverNote)
  }

  async function downloadNote() {
    if (canSave) toast('Your latest unsaved changes are saved first.')
    try {
      if (canSave) await saveNow()
      const response = await api.get(`/student/notes/${note._id}/download`, { responseType: 'blob' })
      saveBlob(response, 'note.html')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${note.title || 'Untitled note'}”? This cannot be undone.`)) return
    try {
      saver.discardPending()
      await notesApi.remove(note._id)
      clearBackup(userId, note._id)
      toast.success('Note deleted')
      onDeleted?.(note._id)
    } catch (error) { toast.error(apiErrorMessage(error)) }
  }

  const lessonHref = useMemo(() => lessonPath(note), [note])

  if (loadError) return <div className="note-detail"><div className="note-detail-header">{onBack && <button type="button" className="note-icon-button" onClick={onBack} aria-label="Back to notes"><ArrowLeft size={16} /></button>}</div><div className="notes-state is-error" role="alert"><TriangleAlert size={18} /><p>{loadError}</p><button type="button" className="button-secondary" onClick={load}>Try again</button></div></div>
  if (!note || !draft) return <div className="note-detail"><div className="notes-state" role="status"><LoaderCircle size={18} className="spin" /><p>Opening note…</p></div></div>

  const canSave = ['pending', 'offline', 'error'].includes(saver.status)
  return <div className={`note-detail note-color-${draft.color || 'default'}`} onKeyDown={onKeyDown}>
    <div className="note-detail-header">
      {onBack && <button type="button" className="note-icon-button" onClick={() => leave(onBack)} aria-label="Back to notes" title="Back to notes"><ArrowLeft size={16} /></button>}
      <SaveStatus status={saver.status} errorMessage={saver.errorMessage} updatedAt={note.updatedAt} />
      <button type="button" className="button-primary note-save-button" onClick={saveNow} disabled={!canSave} title="Save note (Ctrl+S)">{saver.status === 'saving' ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save</button>
      <span className="note-detail-actions">
        {showLessonLink && lessonHref && <Link className="note-icon-button" to={lessonHref} title="Open the lesson for this note" aria-label="Open lesson"><ExternalLink size={15} /></Link>}
        <button type="button" className={`note-icon-button ${detailsOpen ? 'is-active' : ''}`} onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen} title="Color, tags and link" aria-label="Note details"><SlidersHorizontal size={15} /></button>
        {onToggleExpand && <button type="button" className="note-icon-button" onClick={onToggleExpand} title={expanded ? 'Exit wide editor' : 'Expand editor'} aria-label={expanded ? 'Exit wide editor' : 'Expand editor'}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
        <button type="button" className="note-icon-button" onClick={downloadNote} title="Download this note" aria-label="Download this note"><Download size={15} /></button>
        <button type="button" className="note-icon-button danger-text" onClick={remove} title="Delete note" aria-label="Delete note"><Trash2 size={15} /></button>
        {onClose && <button type="button" className="note-icon-button" onClick={() => leave(onClose)} title="Close notes" aria-label="Close notes"><PanelRightClose size={15} /></button>}
      </span>
    </div>

    {backup && <div className="note-banner" role="status"><RotateCcw size={14} /><span>Unsaved changes from {relativeTime(backup.savedAt)} were found on this device{backup.baseVersion < note.version ? ' (the note has been updated since)' : ''}.</span><button type="button" className="button-secondary" onClick={restoreBackup}>Restore</button><button type="button" className="button-quiet" onClick={discardBackup}>Discard</button></div>}
    {conflictNote && <div className="note-banner is-error" role="alert"><TriangleAlert size={14} /><span>This note was changed in another tab or device.</span><button type="button" className="button-secondary" onClick={keepMine}>Keep my version</button><button type="button" className="button-quiet" onClick={useSaved}>Load saved version</button></div>}

    <div className="note-detail-scroll notes-scroll">
      <input className="note-title-input" value={draft.title} maxLength={200} placeholder="Untitled note" aria-label="Note title" onChange={(event) => change({ title: event.target.value })} />
      <div className="note-detail-meta">
        <span>{note.lesson?.title ? `Lesson · ${note.lesson.title}` : note.course?.name ? `Course · ${note.course.name}` : 'General note'}</span>
        <span>{note.wordCount ? `${note.wordCount.toLocaleString()} words` : 'Empty'}</span>
        <span>Edited {relativeTime(note.updatedAt)}</span>
      </div>
      {detailsOpen && <div className="note-details-panel">
        <div className="note-color-picker" role="radiogroup" aria-label="Note color">
          {NOTE_COLORS.map((color) => <button key={color.value} type="button" role="radio" aria-checked={draft.color === color.value} title={color.label} aria-label={color.label} className={`note-swatch note-swatch-${color.value} ${draft.color === color.value ? 'is-active' : ''}`} onClick={() => change({ color: color.value })} />)}
        </div>
        <TagInput tags={draft.tags} onChange={(tags) => change({ tags })} />
        <LinkPicker courseId={draft.course} lessonId={draft.lesson} onChange={(course, lesson) => change({ course, lesson })} />
      </div>}
      <RichTextEditor key={`${note._id}:${editorKey}`} content={draft.content} onChange={(getContent) => saver.queueChange({ content: getContent })} />
    </div>
  </div>
}
