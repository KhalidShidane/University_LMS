import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, BookOpenCheck, ExternalLink, FileText, LoaderCircle, NotebookPen, PanelRightClose } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { ErrorState, PageLoading } from '../../components/ui/States.jsx'
import PrivateFilePreview from '../../components/common/PrivateFilePreview.jsx'
import '../../components/notes/notes.css'
import './StudentLessonDetailsPage.css'

// The notes editor is only downloaded when the student opens the notes panel.
const LessonNotesPanel = lazy(() => import('../../components/notes/LessonNotesPanel.jsx'))

const safeResourceLinks = (links = []) => links.filter((link) => {
  try { return ['http:', 'https:'].includes(new URL(link.url).protocol) } catch { return false }
})

const PANEL_OPEN_KEY = 'lms-notes-panel-open'
const PANEL_WIDTH_KEY = 'lms-notes-panel-width'
const MIN_PANEL = 300
const MAX_PANEL = 820
const drawerQuery = '(max-width: 1023px)'
const readStored = (key, fallback) => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value) } catch { return fallback } }
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ } }

function useIsDrawer() {
  const [isDrawer, setIsDrawer] = useState(() => window.matchMedia(drawerQuery).matches)
  useEffect(() => {
    const media = window.matchMedia(drawerQuery)
    const update = () => setIsDrawer(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return isDrawer
}

export default function StudentLessonDetailsPage() {
  const { id, courseId } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [lesson, setLesson] = useState(null)
  const [course, setCourse] = useState(null)
  const [error, setError] = useState('')
  const isDrawer = useIsDrawer()
  const linkedNoteId = searchParams.get('note')
  const [notesOpen, setNotesOpen] = useState(() => Boolean(linkedNoteId) || (!window.matchMedia(drawerQuery).matches && readStored(PANEL_OPEN_KEY, window.innerWidth >= 1280)))
  const [panelWidth, setPanelWidth] = useState(() => Math.min(MAX_PANEL, Math.max(MIN_PANEL, Number(readStored(PANEL_WIDTH_KEY, 380)) || 380)))
  const [expanded, setExpanded] = useState(false)
  const [resizing, setResizing] = useState(false)
  const layoutRef = useRef(null)

  async function load() {
    setError('')
    try {
      const { data } = courseId ? await api.get(`/student/courses/${courseId}/lessons/${id}`) : await api.get(`/student/lessons/${id}`)
      setLesson(data.lesson); setCourse(data.course || null)
    } catch (requestError) { setError(apiErrorMessage(requestError)) }
  }
  useEffect(() => { load() }, [id, courseId])
  useEffect(() => { if (linkedNoteId) setNotesOpen(true) }, [linkedNoteId])

  const setOpen = useCallback((open) => {
    setNotesOpen(open)
    if (!open) setExpanded(false)
    if (!window.matchMedia(drawerQuery).matches) store(PANEL_OPEN_KEY, open)
  }, [])

  // Close the drawer with Escape on tablets and phones.
  useEffect(() => {
    if (!notesOpen || !isDrawer) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notesOpen, isDrawer, setOpen])

  // The sticky panel must fit between the sticky topbar and whatever sits below the reader
  // (page padding etc.), otherwise it gets pushed up under the topbar near the page end.
  useEffect(() => {
    const layout = layoutRef.current
    if (!notesOpen || isDrawer || !layout) return undefined
    const update = () => {
      const bottom = layout.getBoundingClientRect().bottom + window.scrollY
      const gap = Math.max(0, document.documentElement.scrollHeight - bottom)
      layout.style.setProperty('--notes-bottom-gap', `${Math.ceil(gap)}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [notesOpen, isDrawer, lesson])

  const maxWidth = () => {
    const total = layoutRef.current?.getBoundingClientRect().width || window.innerWidth
    return Math.max(MIN_PANEL, Math.min(MAX_PANEL, total - 380))
  }
  const clampWidth = (value) => Math.round(Math.min(maxWidth(), Math.max(MIN_PANEL, value)))

  function startResize(event) {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    setResizing(true)
    setExpanded(false)
    const move = (moveEvent) => {
      const right = layoutRef.current.getBoundingClientRect().right
      setPanelWidth(clampWidth(right - moveEvent.clientX))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setResizing(false)
      setPanelWidth((width) => { store(PANEL_WIDTH_KEY, width); return width })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  function resizeWithKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    setExpanded(false)
    setPanelWidth((width) => { const next = clampWidth(width + (event.key === 'ArrowLeft' ? 32 : -32)); store(PANEL_WIDTH_KEY, next); return next })
  }

  async function download(material) {
    try { const { data } = await api.get(`/lessons/${id}/materials/${material._id}`, { responseType: 'blob' }); const url = URL.createObjectURL(data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = material.originalName; anchor.click(); URL.revokeObjectURL(url) }
    catch (requestError) { toast.error(apiErrorMessage(requestError)) }
  }
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!lesson) return <PageLoading />

  const effectiveWidth = expanded ? Math.round(maxWidth()) : panelWidth
  return <div ref={layoutRef} className={`lesson-reader ${notesOpen ? 'notes-open' : ''} ${expanded ? 'notes-expanded' : ''}`} style={{ '--notes-width': `${effectiveWidth}px` }}>
    <div className="lesson-reader-main">
      <div className="section-title-row"><div><div className="section-kicker">{course?.courseCode || lesson.subject || lesson.class?.classCode || 'LESSON'}</div><h1>{lesson.title}</h1><p>{course?.name || lesson.class?.name} · Shared by {lesson.createdBy?.fullName || 'your teacher'}</p></div><div className="lesson-card-actions"><button type="button" className={notesOpen ? 'button-secondary lesson-notes-toggle' : 'button-primary lesson-notes-toggle'} onClick={() => setOpen(!notesOpen)} aria-expanded={notesOpen} aria-controls="lesson-notes-panel">{notesOpen ? <PanelRightClose size={15} /> : <NotebookPen size={15} />} {notesOpen ? 'Hide notes' : 'Notes'}</button><Link to={courseId ? `/app/learning/courses/${courseId}` : '/app/learning'} className="button-secondary"><ArrowLeft size={15} /> {courseId ? 'Course lessons' : 'My courses'}</Link></div></div>
      <div className="lesson-detail-banner"><BookOpenCheck size={23} /><span>{lesson.subject || 'Learning material'}</span></div>
      {lesson.summary && <p className="lesson-detail-summary">{lesson.summary}</p>}
      <article className="panel lesson-detail-content"><div className="lesson-content-text">{lesson.content}</div></article>
      {lesson.materials?.length > 0 && <section className="panel lesson-download-panel"><div className="panel-heading"><div><h2>Lesson materials</h2><p>Read supported files here or download a copy.</p></div></div><div className="lesson-material-list">{lesson.materials.map((material) => <div className="lesson-material" key={material._id}><FileText size={17} /><span>{material.originalName}</span><small>{Math.max(1, Math.round(material.size / 1024))} KB</small><PrivateFilePreview src={`/lessons/${id}/materials/${material._id}`} title={material.originalName} mimeType={material.mimeType} /><button className="button-secondary" onClick={() => download(material)}><ArrowDownToLine size={15} /> Download</button></div>)}</div></section>}
      {safeResourceLinks(lesson.attachments).length > 0 && <section className="panel lesson-download-panel"><div className="panel-heading"><div><h2>Online resources</h2><p>Links shared by your teacher.</p></div></div><div className="lesson-resource-links">{safeResourceLinks(lesson.attachments).map((resource, index) => <a key={`${resource.url}-${index}`} href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /><span>{resource.name}</span><ExternalLink size={13} /></a>)}</div></section>}
    </div>
    {notesOpen && !isDrawer && <div className={`notes-resizer ${resizing ? 'is-active' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize notes panel" aria-valuenow={effectiveWidth} aria-valuemin={MIN_PANEL} aria-valuemax={MAX_PANEL} tabIndex={0} onPointerDown={startResize} onKeyDown={resizeWithKeyboard} onDoubleClick={() => { setPanelWidth(380); store(PANEL_WIDTH_KEY, 380) }} title="Drag to resize · double-click to reset" />}
    {notesOpen && isDrawer && <div className="notes-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
    {notesOpen && <Suspense fallback={<aside className="notes-panel notes-panel-loading" id="lesson-notes-panel"><div className="notes-state" role="status"><LoaderCircle size={18} className="spin" /><p>Loading notes…</p></div></aside>}>
      <LessonNotesPanel lesson={lesson} course={course} userId={user.id} initialNoteId={linkedNoteId} expanded={expanded} onToggleExpand={isDrawer ? undefined : () => setExpanded((value) => !value)} onClose={() => setOpen(false)} />
    </Suspense>}
    {!notesOpen && isDrawer && <button type="button" className="notes-fab" onClick={() => setOpen(true)} aria-controls="lesson-notes-panel"><NotebookPen size={16} /> Notes</button>}
  </div>
}
