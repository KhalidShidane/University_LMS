import mongoose from 'mongoose'
import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AuditLog from '../models/AuditLog.js'
import SystemSetting from '../models/SystemSetting.js'
import { courseSemesters } from '../config/academicSemesters.js'
import User from '../models/User.js'
import { getDatabaseStatus } from '../config/db.js'
import { recordAudit, sanitizeAuditMetadata } from '../services/auditLog.service.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const extensions = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'])
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])
const fail = (message) => Object.assign(new Error(message), { status: 400 })
const defaults = () => new SystemSetting().toObject()
const publicSettings = (settings) => ({
  ...settings,
  academic: {
    ...settings.academic,
    semesters: (() => {
      const semesters = settings.academic?.semesters?.length ? [...settings.academic.semesters] : [...courseSemesters]
      if (settings.academic?.semester && !semesters.includes(settings.academic.semester)) semesters.push(settings.academic.semester)
      return semesters
    })(),
    gradingScale: (settings.academic?.gradingScale || []).map(({ label, min, max }) => ({ label, min, max })),
  },
})

export function validateSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Settings must be an object')
  const { general, academic, uploads } = body
  if (!general || !academic || !uploads) throw fail('General, academic, and upload settings are required')
  const allowKeys = (section, keys) => { if (Object.keys(section).some((key) => !keys.includes(key))) throw fail('Settings contain an unsupported field') }
  allowKeys(general, ['institutionName', 'logo', 'contactEmail', 'phone', 'address', 'timezone', 'dateFormat', 'timeFormat'])
  allowKeys(academic, ['academicYear', 'semester', 'semesters', 'gradingScale', 'passingMarks'])
  allowKeys(uploads, ['maxFileSizeMB', 'assignmentTypes', 'learningMaterialTypes', 'profileImageTypes'])
  const text = (value, label, max) => { if (typeof value !== 'string' || value.trim().length > max) throw fail(`${label} is invalid`) }
  text(general.institutionName, 'Institution name', 160)
  text(general.logo, 'Institution logo', 2048)
  text(general.contactEmail, 'Contact email', 254)
  text(general.phone, 'Phone', 40)
  text(general.address, 'Address', 500)
  text(general.timezone, 'Timezone', 80)
  if (general.logo && !/^(https:\/\/|\/uploads\/)[^\s]*$/i.test(general.logo)) throw fail('Logo must be an HTTPS URL or an /uploads path')
  if (general.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(general.contactEmail)) throw fail('Contact email is invalid')
  try { new Intl.DateTimeFormat('en', { timeZone: general.timezone }) } catch { throw fail('Timezone is invalid') }
  if (!['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].includes(general.dateFormat)) throw fail('Date format is invalid')
  if (!['12h', '24h'].includes(general.timeFormat)) throw fail('Time format is invalid')
  text(academic.academicYear, 'Academic year', 20)
  text(academic.semester, 'Semester', 80)
  const semesters = academic.semesters === undefined ? [...courseSemesters] : academic.semesters
  if (!Array.isArray(semesters) || !semesters.length || semesters.length > 30 || semesters.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 80) || new Set(semesters.map((item) => item.trim().toLowerCase())).size !== semesters.length) throw fail('Configure 1 to 30 unique semester names, each 80 characters or fewer')
  if (academic.semester && !semesters.some((item) => item.trim() === academic.semester.trim())) throw fail('The current semester must be selected from the configured semesters')
  if (academic.academicYear && !/^\d{4}(?:[-/](?:\d{2}|\d{4}))?$/.test(academic.academicYear)) throw fail('Academic year must look like 2026-27')
  if (!Number.isFinite(academic.passingMarks) || academic.passingMarks < 0 || academic.passingMarks > 100) throw fail('Passing marks must be between 0 and 100')
  if (!Array.isArray(academic.gradingScale) || academic.gradingScale.length < 2 || academic.gradingScale.length > 12) throw fail('Grading scale must contain 2 to 12 grades')
  if (academic.gradingScale.some((grade) => Object.keys(grade || {}).some((key) => !['label', 'min', 'max'].includes(key)))) throw fail('Grading scale contains an unsupported field')
  const grades = [...academic.gradingScale].sort((a, b) => a.min - b.min)
  if (grades.some((grade, i) => typeof grade.label !== 'string' || !grade.label.trim() || grade.label.length > 20 || !Number.isFinite(grade.min) || !Number.isFinite(grade.max) || grade.min < 0 || grade.max > 100 || grade.min > grade.max || (i > 0 && grade.min <= grades[i - 1].max))) throw fail('Grading ranges must be valid, ordered, and non-overlapping')
  if (grades[0].min !== 0 || grades.at(-1).max !== 100) throw fail('Grading scale must cover 0 through 100')
  if (!Number.isInteger(uploads.maxFileSizeMB) || uploads.maxFileSizeMB < 1 || uploads.maxFileSizeMB > 10) throw fail('Maximum upload size must be 1 to 10 MB; upload middleware retains its hard safety caps')
  const checkTypes = (list, allowed, label) => {
    if (!Array.isArray(list) || !list.length || list.length > allowed.size || list.some((item) => !allowed.has(item))) throw fail(`${label} contains unsupported file types`)
  }
  checkTypes(uploads.assignmentTypes, new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx']), 'Assignment submissions')
  checkTypes(uploads.learningMaterialTypes, extensions, 'Learning materials')
  checkTypes(uploads.profileImageTypes, imageExtensions, 'Profile images')
  return { key: 'global', general: structuredClone(general), academic: { ...structuredClone(academic), semesters: semesters.map((item) => item.trim()) }, uploads: structuredClone(uploads) }
}

export async function getSystemSettings(_req, res) {
  const record = await SystemSetting.findOne({ key: 'global' }).lean()
  return res.json({ success: true, settings: publicSettings(record || defaults()) })
}

export async function updateSystemSettings(req, res) {
  const settings = validateSettings(req.body)
  const prior = await SystemSetting.findOne({ key: 'global' }).lean()
  const record = await SystemSetting.findOneAndUpdate({ key: 'global' }, { $set: settings }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }).lean()
  await recordAudit(req, { action: 'system.settings.updated', resourceType: 'system-settings', resourceId: 'global', metadata: { changedSections: ['general', 'academic', 'uploads'], previousYear: prior?.academic?.academicYear || '', academicYear: record.academic.academicYear, maxFileSizeMB: record.uploads.maxFileSizeMB } })
  return res.json({ success: true, settings: publicSettings(record) })
}

async function auditFilter(query) {
  const filter = {}
  if (query.action) filter.action = String(query.action).slice(0, 100)
  if (query.resourceType) filter.resourceType = String(query.resourceType).slice(0, 80)
  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : null
    const to = query.to ? new Date(query.to) : null
    if ((from && Number.isNaN(+from)) || (to && Number.isNaN(+to)) || (from && to && from > to)) throw fail('Date range is invalid')
    filter.createdAt = {}
    if (from) filter.createdAt.$gte = from
    if (to) { to.setHours(23, 59, 59, 999); filter.createdAt.$lte = to }
  }
  if (query.user) {
    const escaped = String(query.user).slice(0, 160).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matching = mongoose.isValidObjectId(query.user) ? [query.user] : []
    if (!mongoose.isValidObjectId(query.user)) matching.push(...await User.find({ $or: [{ fullName: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }] }).distinct('_id'))
    filter.actorId = { $in: matching }
  }
  return filter
}

export async function listAuditLogs(req, res) {
  const filter = await auditFilter(req.query)
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).populate('actorId', 'fullName email role').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ])
  return res.json({ success: true, logs: rows.map((row) => ({ ...row, metadata: sanitizeAuditMetadata(row.metadata) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
}

export async function getAuditLog(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Audit record not found' })
  const log = await AuditLog.findById(req.params.id).populate('actorId', 'fullName email role').lean()
  if (!log) return res.status(404).json({ success: false, message: 'Audit record not found' })
  return res.json({ success: true, log: { ...log, metadata: sanitizeAuditMetadata(log.metadata) } })
}

const csv = (value) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"` }
export async function exportAuditLogs(req, res) {
  const filter = await auditFilter(req.query)
  const logs = await AuditLog.find(filter).populate('actorId', 'fullName email role').sort({ createdAt: -1 }).limit(5000).lean()
  const rows = [['Timestamp', 'User', 'Email', 'Action', 'Resource', 'Resource ID', 'Metadata', 'IP address'], ...logs.map((log) => [log.createdAt?.toISOString(), log.actorId?.fullName || 'System', log.actorId?.email || '', log.action, log.resourceType, log.resourceId, JSON.stringify(sanitizeAuditMetadata(log.metadata)), log.ipAddress])]
  await recordAudit(req, { action: 'system.audit.exported', resourceType: 'audit-log', metadata: { recordCount: logs.length, filtered: Object.keys(filter).length > 0 } })
  return res.type('text/csv; charset=utf-8').attachment(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`).send(rows.map((row) => row.map(csv).join(',')).join('\r\n'))
}

export async function getSystemHealth(_req, res) {
  const db = getDatabaseStatus()
  let storage = { status: 'unknown', totalBytes: null, freeBytes: null }
  try {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'))
    const stats = await statfs(uploadDir)
    storage = { status: 'available', totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize }
  } catch { storage = { status: 'unavailable', totalBytes: null, freeBytes: null } }
  return res.json({ success: true, health: { api: 'ok', database: db, storage, environment: process.env.NODE_ENV || 'development', version: process.env.npm_package_version || '1.0.0', checkedAt: new Date().toISOString() } })
}
