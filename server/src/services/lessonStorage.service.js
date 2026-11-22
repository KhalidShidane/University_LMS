import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lessonDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../uploads/lessons')

export const allowedMaterialTypes = Object.freeze({
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

export const allowedCoverTypes = Object.freeze({
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
})

export function fileExtension(filename = '') {
  const lastDot = filename.lastIndexOf('.')
  return lastDot < 0 ? '' : filename.slice(lastDot).toLowerCase()
}

export function hasSafeSignature(file, extension) {
  const buffer = file.buffer
  if (extension === '.pdf') return buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === '.webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (['.doc', '.ppt', '.xls'].includes(extension)) return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  if (['.docx', '.pptx', '.xlsx'].includes(extension)) return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2])
  return false
}

export async function storeLessonFile(file, extension) {
  const storedName = `${randomUUID()}${extension}`
  await mkdir(lessonDirectory, { recursive: true })
  await writeFile(join(lessonDirectory, storedName), file.buffer, { flag: 'wx' })
  return storedName
}

export function lessonFilePath(storedName) {
  if (!storedName || !/^[\da-f-]{36}\.(pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|jpeg|png|webp)$/i.test(storedName)) return null
  return join(lessonDirectory, storedName)
}

export async function deleteLessonFile(storedName) {
  const filePath = lessonFilePath(storedName)
  if (filePath) await unlink(filePath).catch(() => {})
}

export async function deleteLessonFiles(lesson) {
  const names = [lesson.coverImage?.storedName, ...(lesson.materials || []).map((item) => item.storedName)].filter(Boolean)
  await Promise.all(names.map(deleteLessonFile))
}
