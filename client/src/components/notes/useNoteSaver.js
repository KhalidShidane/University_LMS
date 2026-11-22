import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorMessage } from '../../services/api.js'
import { clearBackup, notesApi, writeBackup } from './noteUtils.js'

const BACKUP_DELAY_MS = 500

// Field values may be functions (lazy getters) so the editor only serialises its document
// when a save or backup actually happens, which keeps typing smooth in very long notes.
const resolve = (changes) => Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, typeof value === 'function' ? value() : value]))

/**
 * Manual saving for one note: edits are collected locally and only sent to the server when
 * the student presses Save (or Ctrl+S). Unsaved edits are mirrored to localStorage so they
 * can be restored after a crash, closed tab or failed save — they are never sent automatically.
 * status: 'saved' | 'pending' | 'saving' | 'offline' | 'error' | 'conflict'
 */
export default function useNoteSaver({ note, userId, onSaved, onConflict }) {
  const [status, setStatus] = useState('saved')
  const [errorMessage, setErrorMessage] = useState('')
  const noteIdRef = useRef(note?._id)
  const versionRef = useRef(note?.version || 1)
  const pendingRef = useRef({})
  const inFlightRef = useRef(null)
  const backupTimerRef = useRef(null)
  const callbacksRef = useRef({ onSaved, onConflict })
  callbacksRef.current = { onSaved, onConflict }

  const hasUnsaved = useCallback(() => Object.keys(pendingRef.current).length > 0, [])

  const backupNow = useCallback(() => {
    clearTimeout(backupTimerRef.current)
    if (!Object.keys(pendingRef.current).length || !noteIdRef.current) return
    writeBackup(userId, noteIdRef.current, { baseVersion: versionRef.current, changes: resolve(pendingRef.current) })
  }, [userId])

  const save = useCallback(async () => {
    const noteId = noteIdRef.current
    if (!noteId || !Object.keys(pendingRef.current).length) return true
    if (inFlightRef.current) return inFlightRef.current
    clearTimeout(backupTimerRef.current)
    const snapshot = resolve(pendingRef.current)
    pendingRef.current = {}
    setStatus('saving')
    const request = (async () => {
      try {
        const saved = await notesApi.update(noteId, { ...snapshot, version: versionRef.current })
        if (noteIdRef.current !== noteId) return true
        versionRef.current = saved.version
        setErrorMessage('')
        callbacksRef.current.onSaved?.(saved)
        if (Object.keys(pendingRef.current).length) { setStatus('pending'); backupNow() }
        else { setStatus('saved'); clearBackup(userId, noteId) }
        return true
      } catch (error) {
        if (noteIdRef.current !== noteId) return false
        // Keep the unsaved snapshot, plus anything typed while the request was running.
        pendingRef.current = { ...snapshot, ...pendingRef.current }
        backupNow()
        const statusCode = error.response?.status
        if (statusCode === 409 && error.response?.data?.code === 'NOTE_VERSION_CONFLICT') {
          setStatus('conflict')
          callbacksRef.current.onConflict?.(error.response.data.note)
          return false
        }
        if (!error.response || navigator.onLine === false) {
          setStatus('offline')
          setErrorMessage('You are offline. Your changes are kept on this device — press Save again when you are back online.')
          return false
        }
        // A rejected course/lesson link must not block saving the rest of the note.
        if (statusCode && statusCode < 500 && statusCode !== 429) { delete pendingRef.current.course; delete pendingRef.current.lesson }
        setStatus('error')
        setErrorMessage(apiErrorMessage(error))
        return false
      } finally {
        if (noteIdRef.current === noteId) inFlightRef.current = null
      }
    })()
    inFlightRef.current = request
    return request
  }, [backupNow, userId])

  const queueChange = useCallback((changes) => {
    pendingRef.current = { ...pendingRef.current, ...changes }
    setStatus((current) => (current === 'saving' || current === 'conflict' ? current : 'pending'))
    clearTimeout(backupTimerRef.current)
    backupTimerRef.current = setTimeout(backupNow, BACKUP_DELAY_MS)
  }, [backupNow])

  // Resolve a version conflict: keep the local edits (overwrite) or accept the saved copy.
  const keepMine = useCallback((serverNote) => {
    versionRef.current = serverNote.version
    setStatus('pending')
    return save()
  }, [save])
  const discardPending = useCallback((serverNote) => {
    pendingRef.current = {}
    clearTimeout(backupTimerRef.current)
    if (serverNote) versionRef.current = serverNote.version
    clearBackup(userId, noteIdRef.current)
    setStatus('saved')
    setErrorMessage('')
  }, [userId])

  useEffect(() => {
    if (!note?._id) return undefined
    noteIdRef.current = note._id
    versionRef.current = note.version || 1
    pendingRef.current = {}
    setStatus('saved')
    setErrorMessage('')
    // Leaving a note with unsaved edits keeps them in the local backup (offered as Restore
    // next time); nothing is sent to the server without the student pressing Save.
    return () => { clearTimeout(backupTimerRef.current); if (Object.keys(pendingRef.current).length) backupNow() }
  }, [note?._id, userId])

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') backupNow() }
    const beforeUnload = (event) => {
      if (!Object.keys(pendingRef.current).length && !inFlightRef.current) return
      backupNow()
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [backupNow])

  return { status, errorMessage, queueChange, save, hasUnsaved, keepMine, discardPending }
}
