import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import EmailLog from '../models/EmailLog.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import { hashPassword } from '../services/password.service.js'
import { setEmailTransport } from '../services/email/email.service.js'
import { confirmEmailVerification, issueEmailVerification, migrateLegacyEmailVerification } from '../services/emailVerification.service.js'

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_BASE_URL', 'EMAIL_SEND_TIMEOUT_MS', 'EMAIL_PROVIDER', 'CLIENT_URL', 'APP_URL', 'EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS', 'EMAIL_VERIFICATION_MAX_SENDS_PER_DAY']

// Local stand-in for the Resend API (POST /emails). `mode` decides the response.
function startFakeResend() {
  const state = { mode: 'success', requests: [] }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      state.requests.push({ path: req.url, authorization: req.headers.authorization, idempotencyKey: req.headers['idempotency-key'], body: JSON.parse(raw || '{}') })
      if (state.mode === 'timeout') return // never answer
      if (state.mode === 'unauthorized') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ statusCode: 401, name: 'invalid_api_key', message: 'API key is invalid' })) }
      if (state.mode === 'outage') { res.writeHead(503); return res.end('unavailable') }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: `email-${state.requests.length}` }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })))
}

const tokenFrom = (request) => new URL(request.body.text.match(/https?:\/\/\S+/)[0]).pathname.split('/').pop()

test('student email verification: registration, tokens, login gate, resend, limits, provider failures, migration', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated email verification integration checks',
}, async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_email_test_${process.pid}_${Date.now()}`
  const fakeResend = await startFakeResend()
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'email-verification-isolated-test-secret-0123456789',
    RESEND_API_KEY: 're_test_secret_key_123',
    EMAIL_FROM: 'DARSIVO LMS <noreply@example.edu>',
    RESEND_BASE_URL: fakeResend.url,
    EMAIL_SEND_TIMEOUT_MS: '500',
    EMAIL_PROVIDER: 'resend',
    CLIENT_URL: 'https://lms.example.edu',
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: '60',
    EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: '3',
  })
  delete process.env.APP_URL
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), Faculty.init(), Department.init(), Class.init(), EmailLog.init()])
    const faculty = await Faculty.create({ name: 'Email Faculty', code: 'EMF' })
    const department = await Department.create({ name: 'Email Department', code: 'EMD', faculty: faculty._id })
    const academicClass = await Class.create({ name: 'Email Class', classCode: 'EMC', department: department._id })
    const base = `http://127.0.0.1:${server.address().port}/api`
    let ipCounter = 10
    // Each request gets its own client IP unless one is given, so the per-IP limiter is only hit on purpose.
    const request = (path, payload, ip) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `10.0.0.${ipCounter++}` }, body: JSON.stringify(payload) })
    app.set('trust proxy', 1)
    const registration = (email, studentId) => ({ fullName: 'Amina Yusuf', email, password: 'StudentPassword123', studentId, faculty: String(faculty._id), department: String(department._id), class: String(academicClass._id) })

    // --- Migration: pre-existing accounts without the field are not locked out.
    const legacyId = new mongoose.Types.ObjectId()
    await User.collection.insertOne({ _id: legacyId, fullName: 'Legacy Student', email: 'legacy@example.edu', passwordHash: await hashPassword('LegacyPassword123'), role: 'student', studentId: 'LEG1', class: academicClass._id, department: department._id, isActive: true, sessionVersion: 0 })
    assert.equal(await migrateLegacyEmailVerification(), 1)
    assert.equal(await migrateLegacyEmailVerification(), 0, 'migration is idempotent')
    const legacy = await User.findById(legacyId).lean()
    assert.equal(legacy.emailVerified, true)
    assert.equal((await request('/auth/login', { email: 'legacy@example.edu', password: 'LegacyPassword123' })).status, 200)

    // --- Successful registration sends a branded email through Resend with a hashed, expiring token.
    const registered = await request('/auth/register', registration('amina@example.edu', '3001'))
    assert.equal(registered.status, 201)
    const registeredBody = await registered.json()
    assert.deepEqual([registeredBody.verificationRequired, registeredBody.emailSent], [true, true])
    assert.equal(registered.headers.get('set-cookie'), null, 'registration must not start a session')
    assert.equal(fakeResend.state.requests.length, 1)
    const sent = fakeResend.state.requests[0]
    assert.equal(sent.path, '/emails')
    assert.equal(sent.authorization, 'Bearer re_test_secret_key_123')
    assert.match(sent.idempotencyKey || '', /^verify-[a-f0-9]{24}-\d+$/, 'each send carries a unique idempotency key')
    assert.equal(sent.body.from, 'DARSIVO LMS <noreply@example.edu>')
    assert.deepEqual(sent.body.to, ['amina@example.edu'])
    assert.match(sent.body.subject, /Verify your DARSIVO email/)
    assert.match(sent.body.html, /Verify Email/)
    assert.match(sent.body.html, /Hello <strong>Amina<\/strong>/)
    // Real Lucide icons travel as inline (cid) PNG attachments, one per referenced icon.
    const inlineIds = (sent.body.attachments || []).map((attachment) => attachment.content_id).sort()
    assert.deepEqual(inlineIds, ['darsivo-brand', 'darsivo-help', 'darsivo-hero-verify', 'darsivo-lock', 'darsivo-timer'])
    assert.ok(sent.body.attachments.every((attachment) => attachment.content_type === 'image/png' && attachment.content.length > 100))
    for (const id of inlineIds) assert.ok(sent.body.html.includes(`cid:${id}`), `${id} referenced in HTML`)
    assert.match(sent.body.text, /https:\/\/lms\.example\.edu\/verify-email\/[A-Za-z0-9_-]{40,}\s/, 'token is in the link path, not a query string')
    const firstToken = tokenFrom(sent)
    const stored = await User.findOne({ email: 'amina@example.edu' }).select('+emailVerificationTokenHash').lean()
    assert.equal(stored.emailVerified, false)
    assert.notEqual(stored.emailVerificationTokenHash, firstToken, 'only a hash is stored')
    assert.match(stored.emailVerificationTokenHash, /^[a-f0-9]{64}$/)
    assert.ok(stored.emailVerification.expiresAt > new Date(Date.now() + 23 * 3600 * 1000))
    assert.equal(stored.emailVerification.deliveryStatus, 'sent')
    assert.equal(await EmailLog.countDocuments({ type: 'email_verification', status: 'sent' }), 1)

    // --- No duplicate accounts: re-registering points to verification.
    const duplicate = await request('/auth/register', registration('amina@example.edu', '3002'))
    assert.equal(duplicate.status, 409)
    assert.equal((await duplicate.json()).code, 'EMAIL_PENDING_VERIFICATION')
    assert.equal(await User.countDocuments({ email: 'amina@example.edu' }), 1)

    // --- Login before verification is rejected without creating a session.
    const early = await request('/auth/login', { email: 'amina@example.edu', password: 'StudentPassword123' })
    assert.equal(early.status, 403)
    assert.equal((await early.json()).code, 'EMAIL_NOT_VERIFIED')
    assert.equal(early.headers.get('set-cookie'), null)
    const wrongPassword = await request('/auth/login', { email: 'amina@example.edu', password: 'WrongPassword123' })
    assert.equal(wrongPassword.status, 401, 'unverified state is only revealed after a correct password')

    // --- Invalid tokens.
    for (const token of ['', 'short', 'x'.repeat(43), 'y'.repeat(500)]) {
      const response = await request('/auth/verify-email', { token })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).status, 'invalid')
    }

    // --- Resend: generic response, new token replaces the old one, cooldown applies.
    await User.updateOne({ email: 'amina@example.edu' }, { $set: { 'emailVerification.lastSentAt': new Date(Date.now() - 120000) } })
    const resend = await request('/auth/resend-verification', { email: 'AMINA@example.edu' })
    assert.equal(resend.status, 200)
    const resendBody = await resend.json()
    const unknown = await request('/auth/resend-verification', { email: 'nobody@example.edu' })
    assert.deepEqual(await unknown.json(), resendBody, 'same response for unknown accounts (no enumeration)')
    const verifiedAdmin = await request('/auth/resend-verification', { email: 'legacy@example.edu' })
    assert.deepEqual(await verifiedAdmin.json(), resendBody, 'same response for already-verified accounts')
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(fakeResend.state.requests.length, 2, 'only the pending account receives a new email')
    const secondToken = tokenFrom(fakeResend.state.requests[1])
    assert.notEqual(secondToken, firstToken)
    const oldToken = await request('/auth/verify-email', { token: firstToken })
    assert.equal(oldToken.status, 400, 'earlier token is invalidated by a resend')
    await request('/auth/resend-verification', { email: 'amina@example.edu' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(fakeResend.state.requests.length, 2, 'per-account cooldown prevents back-to-back sends')
    const amina = await User.findOne({ email: 'amina@example.edu' }).select('_id').lean()
    assert.equal((await issueEmailVerification(amina._id)).reason, 'cooldown')

    // --- Daily cap per account.
    await User.updateOne({ _id: amina._id }, { $set: { 'emailVerification.lastSentAt': new Date(Date.now() - 120000), 'emailVerification.sendCount': 3 } })
    assert.equal((await issueEmailVerification(amina._id)).reason, 'daily_limit')
    await User.updateOne({ _id: amina._id }, { $set: { 'emailVerification.sendCount': 2 } })

    // --- Expired token.
    await User.updateOne({ _id: amina._id }, { $set: { 'emailVerification.expiresAt': new Date(Date.now() - 1000) } })
    const expired = await request('/auth/verify-email', { token: secondToken })
    assert.equal(expired.status, 400)
    assert.equal((await expired.json()).status, 'expired')
    assert.equal((await User.findById(amina._id).lean()).emailVerified, false)

    // --- Fresh token verifies once; reuse fails; login works afterwards.
    const issued = await issueEmailVerification(amina._id)
    assert.equal(issued.sent, true)
    const validToken = tokenFrom(fakeResend.state.requests.at(-1))
    const verified = await request('/auth/verify-email', { token: validToken })
    assert.equal(verified.status, 200)
    assert.equal((await verified.json()).status, 'verified')
    const verifiedUser = await User.findById(amina._id).select('+emailVerificationTokenHash').lean()
    assert.equal(verifiedUser.emailVerified, true)
    assert.ok(verifiedUser.emailVerifiedAt)
    assert.equal(verifiedUser.emailVerificationTokenHash, undefined)
    const reused = await request('/auth/verify-email', { token: validToken })
    assert.equal(reused.status, 400)
    assert.equal((await reused.json()).status, 'invalid')
    assert.equal(await confirmEmailVerification(validToken), 'invalid')
    const login = await request('/auth/login', { email: 'amina@example.edu', password: 'StudentPassword123' })
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie') || '', /^lms_session=/)

    // --- Existing sessions of an unverified student are rejected.
    const sessionCookie = login.headers.get('set-cookie').split(';')[0]
    await User.updateOne({ _id: amina._id }, { $set: { emailVerified: false } })
    assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: sessionCookie } })).status, 403)
    await User.updateOne({ _id: amina._id }, { $set: { emailVerified: true } })

    // --- Resend failures never undo registration and are recorded.
    for (const [mode, code] of [['unauthorized', 'auth_failed'], ['outage', 'provider_error'], ['timeout', 'timeout']]) {
      fakeResend.state.mode = mode
      const email = `${mode}@example.edu`
      const response = await request('/auth/register', registration(email, String(3010 + ['unauthorized', 'outage', 'timeout'].indexOf(mode))))
      assert.equal(response.status, 201, `${mode}: registration still succeeds`)
      assert.equal((await response.json()).emailSent, false)
      const user = await User.findOne({ email }).lean()
      assert.equal(user.emailVerified, false, `${mode}: account is not marked verified`)
      assert.equal(user.emailVerification.deliveryStatus, 'failed')
      assert.equal(user.emailVerification.deliveryError, code)
      const log = await EmailLog.findOne({ recipientEmail: email }).lean()
      assert.equal(log.status, 'failed')
      assert.equal(log.errorCode, code)
      assert.equal(JSON.stringify(log).includes('re_test_secret_key_123'), false, 'credentials never reach the log')
    }
    // Recovery: once the provider is back, resend delivers to the failed account.
    fakeResend.state.mode = 'success'
    // The 'unauthorized' run above put email into outage mode; resend reports that honestly.
    assert.equal((await request('/auth/resend-verification', { email: 'outage@example.edu' })).status, 503)
    setEmailTransport(null) // simulate the 5-minute re-check window passing
    await User.updateOne({ email: 'outage@example.edu' }, { $set: { 'emailVerification.lastSentAt': new Date(Date.now() - 120000) } })
    const before = fakeResend.state.requests.length
    await request('/auth/resend-verification', { email: 'outage@example.edu' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(fakeResend.state.requests.length, before + 1)
    assert.equal((await User.findOne({ email: 'outage@example.edu' }).lean()).emailVerification.deliveryStatus, 'sent')

    // --- Missing configuration is handled the same way (no crash, nothing verified).
    delete process.env.RESEND_API_KEY
    const unconfigured = await request('/auth/register', registration('noconfig@example.edu', '3020'))
    assert.equal(unconfigured.status, 201)
    assert.equal((await unconfigured.json()).emailSent, false)
    // While the provider is down account-wide, resend says so honestly (same answer for every address).
    const outage = await request('/auth/resend-verification', { email: 'someone.else@example.edu' })
    assert.equal(outage.status, 503)
    assert.equal((await outage.json()).code, 'EMAIL_UNAVAILABLE')
    process.env.RESEND_API_KEY = 're_test_secret_key_123'
    setEmailTransport(null) // clears the remembered outage, as a successful send would
    const withS = await request('/auth/resend-verification', { email: 'students.sss@example.edu' })
    assert.equal(withS.status, 200, 'addresses containing the letter s are valid')

    // --- Per-IP rate limit on resend.
    const statuses = []
    for (let index = 0; index < 6; index += 1) statuses.push((await request('/auth/resend-verification', { email: 'nobody@example.edu' }, '203.0.113.7')).status)
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429])
  } finally {
    setEmailTransport(null)
    app.set('trust proxy', false)
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => { fakeResend.server.closeAllConnections?.(); fakeResend.server.close(resolve) })
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
