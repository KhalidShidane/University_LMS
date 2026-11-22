import AuditLog from '../models/AuditLog.js'

const secretKey = /(password|token|cookie|secret|authorization|file.?content|buffer|credential)/i
function safeValue(value, depth = 0) {
  if (depth > 3 || value == null) return value == null ? null : '[omitted]'
  if (typeof value === 'string') return value.slice(0, 300)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).slice(0, 30).map(([key, item]) => [key.slice(0, 80), safeValue(item, depth + 1)]))
  return '[omitted]'
}

export async function recordAudit(req, { action, resourceType, resourceId = '', metadata = {} }) {
  try {
    return await AuditLog.create({
      actorId: req?.user?._id || null,
      action: String(action).slice(0, 100),
      resourceType: String(resourceType).slice(0, 80),
      resourceId: String(resourceId || '').slice(0, 100),
      metadata: safeValue(metadata),
      ipAddress: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64),
      userAgent: String(req?.get?.('user-agent') || '').slice(0, 300),
    })
  } catch (error) {
    console.error('Audit log write failed', error.message)
    return null
  }
}

export function sanitizeAuditMetadata(value) { return safeValue(value) }
