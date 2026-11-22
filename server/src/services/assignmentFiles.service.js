import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const uploadRoot = join(dirname(fileURLToPath(import.meta.url)), '../../uploads')
const attachmentRoot = join(uploadRoot, 'assignments')

export const maxSubmissionBytes = Math.min(100 * 1024 * 1024, Math.max(1024, Number(process.env.ASSIGNMENT_MAX_FILE_SIZE) || 10 * 1024 * 1024))
export const maxAttachmentBytes = Math.min(100 * 1024 * 1024, Math.max(1024, Number(process.env.ASSIGNMENT_ATTACHMENT_MAX_FILE_SIZE) || 15 * 1024 * 1024))
export const maxAssignmentAttachments = 5
export const submissionImageExtensions = Object.freeze(['.jpg', '.jpeg', '.png', '.webp'])

export const allowedAssignmentFiles = Object.freeze({
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/vnd.ms-word'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
})

export function extensionOf(name = '') {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index).toLowerCase()
}

export function safeOriginalName(name = '') {
  const base = String(name).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return base.slice(0, 255) || 'uploaded-file'
}

export function hasValidSignature(file, extension) {
  const b = file.buffer
  if (!b?.length) return false
  if (extension === '.pdf') return b.length >= 5 && b.subarray(0, 5).equals(Buffer.from('%PDF-'))
  if (['.jpg', '.jpeg'].includes(extension)) return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (extension === '.png') return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === '.webp') return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
  if (['.doc', '.ppt', '.xls'].includes(extension)) return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  if (['.docx', '.pptx', '.xlsx'].includes(extension)) return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2])
  return false
}

export async function storeSubmission(file, extension = extensionOf(file.originalname)) {
  const storedName = `${randomUUID()}${extension}`
  await mkdir(uploadRoot, { recursive: true })
  await writeFile(join(uploadRoot, storedName), file.buffer, { flag: 'wx' })
  return storedName
}

export async function storeAssignmentAttachment(file, extension) {
  const storedName = `${randomUUID()}${extension}`
  await mkdir(attachmentRoot, { recursive: true })
  await writeFile(join(attachmentRoot, storedName), file.buffer, { flag: 'wx' })
  return storedName
}

export function submissionPath(storedName) {
  return /^[\da-f-]{36}\.(pdf|doc|docx|ppt|pptx|jpg|jpeg|png|webp)$/i.test(storedName || '') ? join(uploadRoot, storedName) : null
}

export function attachmentPath(storedName) {
  return /^[\da-f-]{36}\.(pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|jpeg|png|webp)$/i.test(storedName || '')
    ? join(attachmentRoot, storedName)
    : null
}

export async function removeStoredFile(filePath) {
  if (filePath) await unlink(filePath).catch(() => {})
}

export const submissionFilePath = (name) => submissionPath(name)
export const assignmentFilePath = (name) => attachmentPath(name)
