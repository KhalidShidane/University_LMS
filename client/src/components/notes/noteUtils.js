import api from '../../services/api.js'

export const NOTE_COLORS = [
  { value: 'default', label: 'No color' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'orange', label: 'Orange' },
]

export const emptyDocument = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })

export const notesApi = {
  list: (params) => api.get('/student/notes', { params }).then(({ data }) => data),
  facets: () => api.get('/student/notes/facets').then(({ data }) => data),
  get: (id) => api.get(`/student/notes/${id}`).then(({ data }) => data.note),
  create: (body) => api.post('/student/notes', body).then(({ data }) => data.note),
  update: (id, body) => api.patch(`/student/notes/${id}`, body).then(({ data }) => data.note),
  remove: (id) => api.delete(`/student/notes/${id}`),
  reorder: (ids) => api.put('/student/notes/order', { ids }),
}

export function noteTitle(note) {
  return note?.title?.trim() || 'Untitled note'
}

export function noteContextLabel(note) {
  if (note?.lesson?.title) return note.lesson.title
  if (note?.course?.name) return note.course.courseCode ? `${note.course.courseCode} · ${note.course.name}` : note.course.name
  return 'General note'
}

export function relativeTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(date)
}

export function lessonPath(note) {
  const lessonId = note?.lesson?._id
  if (!lessonId) return ''
  return note.course?._id ? `/app/learning/courses/${note.course._id}/lessons/${lessonId}?note=${note._id}` : ''
}

// Local backup of unsaved edits so nothing is lost on a crash, closed tab or network failure.
const backupKey = (userId, noteId) => `lms-note-backup:${userId}:${noteId}`

export function readBackup(userId, noteId) {
  try {
    const raw = localStorage.getItem(backupKey(userId, noteId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function writeBackup(userId, noteId, value) {
  try { localStorage.setItem(backupKey(userId, noteId), JSON.stringify({ ...value, savedAt: Date.now() })); return true } catch { return false }
}

export function clearBackup(userId, noteId) {
  try { localStorage.removeItem(backupKey(userId, noteId)) } catch { /* storage unavailable */ }
}
