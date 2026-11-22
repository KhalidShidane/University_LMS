import { readFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import JSZip from 'jszip'
import Lesson from '../models/Lesson.js'
import Note from '../models/Note.js'
import { lessonFilePath } from '../services/lessonStorage.service.js'
import { noteToHtmlDocument, safeFileName, uniqueName } from '../services/noteExport.service.js'
import { requireStudentCourse } from './lessons.controller.js'

const MAX_ZIP_BYTES = 300 * 1024 * 1024
const fail = (status, message) => Object.assign(new Error(message), { status })
const today = () => new Date().toISOString().slice(0, 10)

function sendZip(res, zip, filename) {
  res.type('application/zip').attachment(filename)
  return new Promise((resolve, reject) => {
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } })
      .on('error', reject)
      .pipe(res)
      .on('finish', resolve)
      .on('error', reject)
  })
}

/** Student: every material of every published lesson in one course, as one ZIP (a folder per lesson). */
export async function downloadCourseMaterialsZip(req, res) {
  const course = await requireStudentCourse(req.user._id, req.params.courseId)
  if (!course) return res.status(404).json({ success: false, message: 'Course not found' })
  // Same access rule as the student's course lesson list.
  const lessons = await Lesson.find({ course: course._id, class: course.class, isPublished: true }).select('title materials order createdAt').sort({ order: 1, createdAt: 1 }).lean()
  const withFiles = lessons.filter((lesson) => lesson.materials?.length)
  const totalBytes = withFiles.reduce((sum, lesson) => sum + lesson.materials.reduce((acc, item) => acc + (item.size || 0), 0), 0)
  if (!withFiles.length) return res.status(404).json({ success: false, message: 'This course has no downloadable materials yet' })
  if (totalBytes > MAX_ZIP_BYTES) return res.status(413).json({ success: false, message: 'These materials are too large to download at once. Download them lesson by lesson.' })

  const root = safeFileName(`${course.courseCode ? `${course.courseCode} - ` : ''}${course.name}`, 'Course materials')
  const zip = new JSZip()
  const folders = new Set()
  let added = 0
  for (const [index, lesson] of withFiles.entries()) {
    const folder = uniqueName(`${String(index + 1).padStart(2, '0')} - ${safeFileName(lesson.title, 'Lesson', 60)}`, folders)
    const names = new Set()
    for (const material of lesson.materials) {
      const path = lessonFilePath(material.storedName)
      if (!path) continue
      try {
        zip.file(`${root}/${folder}/${uniqueName(safeFileName(material.originalName, 'material', 120), names)}`, await readFile(path), { date: material.uploadedAt ? new Date(material.uploadedAt) : new Date() })
        added += 1
      } catch {
        // A missing file on disk must not break the whole download.
      }
    }
  }
  if (!added) return res.status(404).json({ success: false, message: 'The material files could not be found. Contact your teacher.' })
  return sendZip(res, zip, `${safeFileName(root, 'course', 60).replace(/\s+/g, '-')}-materials-${today()}.zip`)
}

const notePopulate = (query) => query.populate('course', 'name courseCode').populate('lesson', 'title')

/** Student: one note as a standalone HTML document. */
export async function downloadNote(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, 'A valid note ID is required')
  const note = await notePopulate(Note.findOne({ _id: req.params.id, student: req.user._id })).lean()
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' })
  return res.type('text/html; charset=utf-8').attachment(`${safeFileName(note.title, 'note', 80)}.html`).send(noteToHtmlDocument(note))
}

/** Student: all of their notes as a ZIP, grouped by course. */
export async function downloadAllNotesZip(req, res) {
  const notes = await notePopulate(Note.find({ student: req.user._id })).sort({ updatedAt: -1 }).lean()
  if (!notes.length) return res.status(404).json({ success: false, message: 'You have no notes to download yet' })
  const zip = new JSZip()
  const namesByFolder = new Map()
  for (const note of notes) {
    const folder = safeFileName(note.course ? `${note.course.courseCode ? `${note.course.courseCode} - ` : ''}${note.course.name}` : 'General notes', 'General notes', 70)
    if (!namesByFolder.has(folder)) namesByFolder.set(folder, new Set())
    const file = uniqueName(`${safeFileName(note.title, 'Untitled note', 80)}.html`, namesByFolder.get(folder))
    zip.file(`My notes/${folder}/${file}`, noteToHtmlDocument(note), { date: note.updatedAt ? new Date(note.updatedAt) : new Date() })
  }
  return sendZip(res, zip, `my-notes-${today()}.zip`)
}
