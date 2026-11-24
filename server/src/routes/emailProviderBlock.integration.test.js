import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import EmailJob from '../models/EmailJob.js'
import EmailLog from '../models/EmailLog.js'
import EmailProviderState from '../models/EmailProviderState.js'
import { hashPassword } from '../services/password.service.js'
import { setEmailTransport } from '../services/email/email.service.js'
import { processEmailQueueOnce } from '../services/email/emailQueue.service.js'
import { clearProviderStatusCache, effectiveProviderStatus, getProviderStatus } from '../services/email/providerStatus.service.js'

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_BASE_URL', 'EMAIL_TEST_RECIPIENT', 'EMAIL_SEND_TIMEOUT_MS', 'EMAIL_PROVIDER', 'CLIENT_URL', 'EMAIL_DAILY_LIMIT', 'EMAIL_MAX_PER_MINUTE']
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const DOMAIN_NOT_VERIFIED = 'The techrosolutions.com domain is not verified. Please, add and verify your domain on https://resend.com/domains'

// Fake Resend API: POST /emails answers per `mode`; GET /domains (credential check) always succeeds,
// exactly like a real account whose key works but whose sending domain is not verified yet.
function startFakeResend() {
  const state = { mode: 'success', sends: [], checks: 0 }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      if (req.method === 'GET') { state.checks += 1; res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"object":"list","data":[]}') }
      state.sends.push(JSON.parse(raw || '{}'))
      if (state.mode === 'blocked') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ statusCode: 403, name: 'validation_error', message: DOMAIN_NOT_VERIFIED })) }
      if (state.mode === 'badkey') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ statusCode: 401, name: 'invalid_api_key', message: 'API key is invalid' })) }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: `email-${state.sends.length}` }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })))
}

test('email provider block (Resend 403 unverified domain): pause, preserve, admin test-and-resume, no duplicates', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated email provider integration checks',
}, async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_block_test_${process.pid}_${Date.now()}`
  const fakeResend = await startFakeResend()
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'email-block-isolated-test-secret-0123456789', RESEND_API_KEY: 're_fake_private_key_456', EMAIL_FROM: 'DARSIVO LMS <noreply@example.edu>', RESEND_BASE_URL: fakeResend.url, EMAIL_TEST_RECIPIENT: 'tester@example.edu', EMAIL_SEND_TIMEOUT_MS: '1000', EMAIL_PROVIDER: 'resend', CLIENT_URL: 'https://lms.example.edu', EMAIL_DAILY_LIMIT: '200', EMAIL_MAX_PER_MINUTE: '240' })
  setEmailTransport(null)
  clearProviderStatusCache()
  const server = app.listen(0)

  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await Promise.all([User.init(), EmailJob.init(), EmailLog.init(), EmailProviderState.init()])
    const password = await hashPassword('Password12345')
    const faculty = await Faculty.create({ name: 'Block Faculty', code: 'BF' })
    const department = await Department.create({ name: 'Block Department', code: 'BD', faculty: faculty._id })
    const academicClass = await Class.create({ name: 'Block Class', classCode: 'BC', department: department._id })
    const admin = await User.create({ fullName: 'Admin', email: 'admin@example.edu', passwordHash: password, role: 'admin', emailVerified: true })
    const teacher = await User.create({ fullName: 'Teacher', email: 'teacher@example.edu', passwordHash: password, role: 'teacher', emailVerified: true })
    const students = await Promise.all(['Ana', 'Bilan', 'Cali'].map((name) => User.create({ fullName: name, email: `${name.toLowerCase()}@example.edu`, passwordHash: password, role: 'student', studentId: name.toUpperCase(), department: department._id, class: academicClass._id, emailVerified: true })))
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    const login = async (email) => (await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Password12345' }) })).headers.get('set-cookie').split(';')[0]
    const adminCookie = await login(admin.email)
    const teacherCookie = await login(teacher.email)
    const register = (email, studentId) => request('/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'New Student', email, password: 'Password12345', studentId, faculty: String(faculty._id), department: String(department._id), class: String(academicClass._id) }) })
    const queueJobs = (prefix, expiresAt = new Date(Date.now() + 3600 * 1000)) => EmailJob.insertMany(students.map((student) => ({ template: 'announcement', category: 'announcements', recipientUser: student._id, recipientEmail: student.email, recipientName: student.fullName, dedupeKey: `${prefix}:${student._id}`, data: { title: 'Notice', message: 'Hello', url: 'https://lms.example.edu/app/announcements' }, expiresAt })))

    // ---- 0. A block left over from a previous provider (no provider name) does not affect Resend.
    await EmailProviderState.create({ key: 'global', status: 'temporarily_blocked', since: new Date(), httpStatus: 401, providerErrorCode: 'old-provider' })
    clearProviderStatusCache()
    assert.equal((await register('switch@example.edu', '2001')).status, 201)
    assert.equal((await User.findOne({ email: 'switch@example.edu' }).lean()).emailVerification.deliveryStatus, 'sent', 'Resend sends despite the old block')
    assert.equal((await (await request('/admin/email/status', { headers: { cookie: adminCookie } })).json()).provider.status, 'ok')

    // ---- A different 401 (bad credentials) is not treated as a provider block.
    fakeResend.state.mode = 'badkey'
    assert.equal((await register('badkey@example.edu', '2002')).status, 201)
    assert.equal(effectiveProviderStatus(await getProviderStatus({ fresh: true }), 'resend'), 'ok')
    assert.equal((await User.findOne({ email: 'badkey@example.edu' }).lean()).emailVerification.deliveryError, 'auth_failed')

    // ---- 1. Resend 403 "domain is not verified" is recognised and recorded as a provider-level block.
    fakeResend.state.mode = 'blocked'
    assert.equal((await register('first@example.edu', '2003')).status, 201, 'registration still succeeds')
    const first = await User.findOne({ email: 'first@example.edu' }).lean()
    assert.equal(first.emailVerified, false, 'never marked verified/delivered')
    assert.deepEqual([first.emailVerification.deliveryStatus, first.emailVerification.deliveryError], ['failed', 'provider_blocked'])
    const blockedState = await getProviderStatus({ fresh: true })
    assert.equal(blockedState.status, 'temporarily_blocked')
    assert.deepEqual([blockedState.httpStatus, blockedState.providerErrorCode], [403, 'validation_error'])
    assert.match(blockedState.lastErrorMessage, /domain is not verified/)
    const blockedSince = blockedState.since
    assert.ok(blockedSince)
    const failedLog = await EmailLog.findOne({ recipientEmail: 'first@example.edu' }).lean()
    assert.deepEqual([failedLog.status, failedLog.errorCode], ['failed', 'provider_blocked'])

    // ---- 2. While blocked, nothing calls the provider (no retry loop) and nothing is marked sent.
    const sendsAtBlock = fakeResend.state.sends.length
    assert.equal((await register('second@example.edu', '2004')).status, 201)
    assert.equal(fakeResend.state.sends.length, sendsAtBlock, 'provider not called while blocked')
    const skipped = await EmailLog.findOne({ recipientEmail: 'second@example.edu' }).lean()
    assert.deepEqual([skipped.status, skipped.errorCode], ['skipped', 'provider_blocked'])
    const resend = await request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: 'first@example.edu' }) })
    assert.equal(resend.status, 503)
    assert.equal((await resend.json()).code, 'EMAIL_UNAVAILABLE')
    // Still blocked well past the old 5-minute window: the block is persistent, not time-based.
    clearProviderStatusCache()
    assert.equal((await request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: 'first@example.edu' }) })).status, 503)

    // ---- 3. Queue pauses and preserves jobs (no attempts used, nothing expires while paused).
    await queueJobs('notice', new Date(Date.now() + 1000))
    for (let run = 0; run < 3; run += 1) {
      const result = await processEmailQueueOnce()
      assert.equal(result.paused, true)
      assert.equal(result.sent, 0)
    }
    await wait(1100) // jobs pass their original expiry while paused
    assert.equal((await processEmailQueueOnce()).paused, true)
    assert.equal(fakeResend.state.sends.length, sendsAtBlock, 'paused queue never calls the provider')
    const paused = await EmailJob.find({ dedupeKey: /^notice:/ }).lean()
    assert.ok(paused.every((job) => job.status === 'pending' && job.attempts === 0), 'jobs kept pending with no attempts used')

    // ---- 4. Admin status endpoint (admin only).
    assert.equal((await request('/admin/email/status', { headers: { cookie: teacherCookie } })).status, 403)
    const status = await (await request('/admin/email/status', { headers: { cookie: adminCookie } })).json()
    assert.equal(status.provider.status, 'temporarily_blocked')
    assert.equal(status.provider.providerErrorCode, 'validation_error')
    assert.equal(status.queue.pending, 3)
    assert.equal(/re_fake_private_key_456/.test(JSON.stringify(status)), false, 'no credentials in the response')

    // ---- 5. Test-and-resume while Resend still refuses: nothing resumes.
    assert.equal((await request('/admin/email/test-and-resume', { method: 'POST', headers: { cookie: teacherCookie } })).status, 403)
    const stillBlocked = await (await request('/admin/email/test-and-resume', { method: 'POST', headers: { cookie: adminCookie } })).json()
    assert.deepEqual([stillBlocked.success, stillBlocked.resumed, stillBlocked.stage], [false, false, 'send'])
    assert.equal(stillBlocked.test.providerErrorCode, 'validation_error')
    assert.equal(fakeResend.state.checks, 1, 'credential check ran')
    assert.equal(fakeResend.state.sends.length, sendsAtBlock + 1, 'exactly one test email attempted')
    assert.equal((await getProviderStatus({ fresh: true })).status, 'temporarily_blocked')
    assert.equal((await getProviderStatus({ fresh: true })).since.getTime(), blockedSince.getTime(), 'block start is preserved')
    assert.equal((await processEmailQueueOnce()).paused, true)

    // ---- 6. A job already claimed when the block hits goes back to waiting without losing an attempt.
    // Simulate the provider looking healthy (as before the first failure) with jobs still valid.
    await EmailJob.updateMany({ dedupeKey: /^notice:/ }, { $set: { expiresAt: new Date(Date.now() + 3600 * 1000) } })
    await EmailProviderState.updateOne({ key: 'global' }, { $set: { status: 'ok' } })
    clearProviderStatusCache()
    const inFlight = await processEmailQueueOnce()
    assert.equal(inFlight.paused, true, 'worker stops at the first blocked send')
    assert.equal((await getProviderStatus({ fresh: true })).status, 'temporarily_blocked')
    assert.ok((await EmailJob.find({ dedupeKey: /^notice:/ }).lean()).every((job) => job.status === 'pending' && job.attempts === 0))
    assert.equal(await EmailJob.countDocuments({ status: 'sent' }), 0, 'failed emails are never marked delivered')

    // ---- 7. The domain is verified: admin test-and-resume sends each waiting email exactly once.
    fakeResend.state.mode = 'success'
    const sendsBeforeResume = fakeResend.state.sends.length
    const resumed = await (await request('/admin/email/test-and-resume', { method: 'POST', headers: { cookie: adminCookie } })).json()
    assert.deepEqual([resumed.success, resumed.resumed], [true, true])
    assert.equal(resumed.queue.pending, 3)
    assert.equal(resumed.provider.status, 'ok')
    assert.deepEqual(fakeResend.state.sends[sendsBeforeResume].to, ['tester@example.edu'], 'test email goes to EMAIL_TEST_RECIPIENT')
    const extended = await EmailJob.find({ dedupeKey: /^notice:/ }).lean()
    assert.ok(extended.every((job) => job.expiresAt > new Date()), 'expiry extended by the time spent paused')
    await wait(300) // resume triggers an immediate queue run
    await processEmailQueueOnce()
    await processEmailQueueOnce()
    const delivered = fakeResend.state.sends.slice(sendsBeforeResume + 1).map((body) => body.to[0]).sort()
    assert.deepEqual(delivered, ['ana@example.edu', 'bilan@example.edu', 'cali@example.edu'], 'each waiting email sent exactly once')
    assert.equal(await EmailJob.countDocuments({ dedupeKey: /^notice:/, status: 'sent' }), 3)

    // ---- 8. Verification works again after resuming.
    await User.updateOne({ email: 'first@example.edu' }, { $set: { 'emailVerification.lastSentAt': new Date(Date.now() - 120000) } })
    assert.equal((await request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: 'first@example.edu' }) })).status, 200)
    await wait(300)
    assert.equal((await User.findOne({ email: 'first@example.edu' }).lean()).emailVerification.deliveryStatus, 'sent')
  } finally {
    setEmailTransport(null)
    clearProviderStatusCache()
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
