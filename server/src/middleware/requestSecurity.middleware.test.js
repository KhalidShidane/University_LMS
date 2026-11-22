import test from 'node:test'
import assert from 'node:assert/strict'
import { preventNoSqlInjection, protectCookieRequests } from './requestSecurity.middleware.js'

test('NoSQL middleware removes operator and prototype keys in body and query', () => {
  const req = { body: { email: 'person@example.edu', $where: 'malicious', nested: { ['__proto__']: { role: 'admin' }, safe: true } }, query: { page: '2', $ne: 'x' } }
  preventNoSqlInjection(req, {}, () => {})
  assert.deepEqual(req.body, { email: 'person@example.edu', nested: { safe: true } })
  assert.deepEqual(req.query, { page: '2' })
})

test('cookie mutation requests reject cross-site metadata and untrusted origins', () => {
  const statusCodes = []
  const res = { status(code) { statusCodes.push(code); return this }, json(body) { this.body = body; return this } }
  let passed = 0
  protectCookieRequests({ method: 'POST', get: (name) => ({ origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })[name] }, res, () => { passed += 1 })
  assert.deepEqual(statusCodes, [403])
  assert.equal(passed, 0)
})
