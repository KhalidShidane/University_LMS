import { randomUUID } from 'node:crypto'
import { assertFileIsSafe } from '../services/fileScan.service.js'
import { mkdir, unlink } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'

const profileDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../uploads/profiles')
const imageTypes = {
  'image/jpeg': { extension: '.jpg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: '.png', matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: '.webp', matches: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
}

function profileFilePath(filename) {
  if (!filename || !/^[\da-f-]{36}\.(jpg|png|webp)$/i.test(filename)) return null
  return join(profileDirectory, filename)
}

export async function uploadProfilePhoto(req, res) {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose a JPEG, PNG, or WebP photo' })
  const settings = await loadSystemSettings()
  const type = imageTypes[req.file.mimetype]
  if (!type?.matches(req.file.buffer) || !settings.uploads.profileImageTypes.includes(type.extension.slice(1)) || req.file.size > 1024 * 1024) {
    return res.status(400).json({ success: false, message: 'The uploaded file is not a valid supported image' })
  }

  const storedName = `${randomUUID()}${type.extension}`
  const newPath = join(profileDirectory, storedName)
  await mkdir(profileDirectory, { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await assertFileIsSafe(req.file.buffer, req.file.originalname)
  await writeFile(newPath, req.file.buffer, { flag: 'wx' })

  const user = await User.findById(req.user._id).exec()
  if (!user) {
    await unlink(newPath).catch(() => {})
    return res.status(404).json({ success: false, message: 'Account not found' })
  }
  const previousPath = profileFilePath(user.profileImage)
  user.profileImage = storedName
  try {
    await user.save()
  } catch (error) {
    await unlink(newPath).catch(() => {})
    throw error
  }
  if (previousPath) await unlink(previousPath).catch(() => {})

  return res.json({ success: true, profileImage: storedName })
}

export async function removeProfilePhoto(req, res) {
  const user = await User.findById(req.user._id).exec()
  if (!user) return res.status(404).json({ success: false, message: 'Account not found' })
  const previousPath = profileFilePath(user.profileImage)
  user.profileImage = ''
  await user.save()
  if (previousPath) await unlink(previousPath).catch(() => {})
  return res.json({ success: true, profileImage: '' })
}

export async function updateOwnProfile(req, res) {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : ''
  if (!fullName) return res.status(400).json({ success: false, message: 'Name is required' })
  if (fullName.length > 160) return res.status(400).json({ success: false, message: 'Name must be 160 characters or fewer' })

  const user = await User.findById(req.user._id).exec()
  if (!user) return res.status(404).json({ success: false, message: 'Account not found' })
  user.fullName = fullName
  await user.save()
  return res.json({ success: true, user: { id: user._id, fullName: user.fullName } })
}

export async function getProfilePhoto(req, res) {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(400).json({ success: false, message: 'Invalid account ID' })
  }
  const user = await User.findById(req.params.userId).select('profileImage').lean()
  if (!user?.profileImage) return res.status(404).json({ success: false, message: 'Profile photo not found' })
  const filePath = profileFilePath(user.profileImage)
  if (!filePath) return res.status(404).json({ success: false, message: 'Profile photo not found' })

  const extension = extname(filePath).toLowerCase()
  res.type(extension)
  res.set('Cache-Control', 'private, max-age=3600')
  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).end()
  })
}
