import { isAllowedClientOrigin } from '../config/securityConfig.js'

const blockedKeys = new Set(['__proto__', 'prototype', 'constructor'])
function clean(value) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(clean); return }
  for (const key of Object.keys(value)) {
    if (blockedKeys.has(key) || key.startsWith('$') || key.includes('.')) delete value[key]
    else clean(value[key])
  }
}

export function preventNoSqlInjection(req, _res, next) {
  clean(req.body)
  const query = req.query
  clean(query)
  Object.defineProperty(req, 'query', { configurable: true, enumerable: true, writable: true, value: query })
  next()
}

export function auditMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  res.once('finish', () => {
    if (res.statusCode >= 400) return
    import('../services/auditLog.service.js').then(({ recordAudit }) => {
      const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean)
      const root = parts[1] || 'system'
      const resourceType = parts[2] || root
      const terminal = parts.at(-1) || resourceType
      const verb = req.method === 'POST' ? (terminal === 'submit' ? 'submitted' : 'created') : req.method === 'DELETE' ? 'deleted' : terminal === 'grade' ? 'graded' : terminal === 'results' ? 'results.released' : terminal === 'status' ? 'status.changed' : 'updated'
      const id = parts.find((part, index) => index > 2 && /^[a-f\d]{24}$/i.test(part)) || ''
      recordAudit(req, { action: `${root}.${resourceType}.${verb}`.slice(0, 100), resourceType, resourceId: id, metadata: { method: req.method } })
    }).catch(() => {})
  })
  return next()
}

export function protectCookieRequests(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const fetchSite = req.get('sec-fetch-site')
  if (fetchSite === 'cross-site') return res.status(403).json({ success: false, message: 'Cross-site request rejected' })
  const origin = req.get('origin')
  if (!origin) return next()
  if (!isAllowedClientOrigin(origin)) return res.status(403).json({ success: false, message: 'Request origin is not allowed' })
  return next()
}
