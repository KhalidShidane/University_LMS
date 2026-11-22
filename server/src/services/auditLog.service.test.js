import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAuditMetadata } from './auditLog.service.js'

test('audit metadata omits credentials and bounds nested content', () => {
  const result = sanitizeAuditMetadata({ action: 'user.updated', password: 'secret', token: 'jwt', nested: { cookie: 'session', count: 4 }, list: Array.from({ length: 30 }, (_, index) => index) })
  assert.deepEqual(result, { action: 'user.updated', nested: { count: 4 }, list: Array.from({ length: 20 }, (_, index) => index) })
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal(JSON.stringify(result).includes('jwt'), false)
})
