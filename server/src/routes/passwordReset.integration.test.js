import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import { hashPassword } from '../services/password.service.js'
import { setEmailTransport } from '../services/email/email.service.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('forgot password: generic answers, single-use expiring link, sessions revoked, notice email', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated password reset checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_reset_test_${process.pid}_${Date.now()}`
  const previous = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, CLIENT_URL: process.env.CLIENT_URL, APP_URL: process.env.APP_URL }
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'reset-isolated-test-secret-0123456789abcdef', CLIENT_URL: 'https://lms.example.edu' })
  delete process.env.APP_URL
  const outbox = []
  setEmailTransport({ name: 'test', async send(message) { outbox.push(message); return { providerMessageId: `m${outbox.length}` } } })
  app.set('trust proxy', 1)
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await User.init()
    await User.create({ fullName: 'Hodan Ali', email: 'hodan@example.edu', passwordHash: await hashPassword('OldPassword123'), role: 'admin', emailVerified: true, loginLock: { failures: 4 } })
    const base = `http://127.0.0.1:${server.address().port}/api`
    let ip = 1
    const post = (path, body, extra = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${ip++}`, ...extra }, body: JSON.stringify(body) })
    const tokenFrom = (message) => new URL(message.text.match(/https?:\/\/\S+\/reset-password\/\S+/)[0]).pathname.split('/').pop()

    // Existing session, which must be revoked by the reset.
    const oldLogin = await post('/auth/login', { email: 'hodan@example.edu', password: 'OldPassword123' })
    const oldCookie = oldLogin.headers.get('set-cookie').split(';')[0]

    // Same answer for known and unknown emails; only the known one gets an email.
    const known = await (await post('/auth/forgot-password', { email: 'HODAN@example.edu' })).json()
    const unknown = await (await post('/auth/forgot-password', { email: 'nobody@example.edu' })).json()
    assert.deepEqual(known, unknown)
    assert.equal((await post('/auth/forgot-password', { email: 'not-an-email' })).status, 400)
    await wait(300)
    assert.equal(outbox.length, 1)
    assert.match(outbox[0].subject, /Reset your DARSIVO password/)
    assert.match(outbox[0].html, /Choose a new password/)
    const token = tokenFrom(outbox[0])
    const stored = await User.findOne({ email: 'hodan@example.edu' }).select('+passwordResetTokenHash').lean()
    assert.match(stored.passwordResetTokenHash, /^[a-f0-9]{64}$/)
    assert.notEqual(stored.passwordResetTokenHash, token, 'only a hash is stored')

    // Cooldown: a second request within a minute does not send another email.
    await post('/auth/forgot-password', { email: 'hodan@example.edu' })
    await wait(300)
    assert.equal(outbox.length, 1)

    // Validation and bad tokens.
    assert.equal((await post('/auth/reset-password', { token, password: 'short' })).status, 400)
    const bad = await post('/auth/reset-password', { token: 'x'.repeat(43), password: 'NewPassword123' })
    assert.equal((await bad.json()).status, 'invalid')

    // Successful reset.
    const reset = await post('/auth/reset-password', { token, password: 'NewPassword123' })
    assert.equal(reset.status, 200)
    assert.equal((await reset.json()).status, 'reset')
    assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: oldCookie } })).status, 401, 'existing sessions are signed out')
    assert.equal((await post('/auth/login', { email: 'hodan@example.edu', password: 'OldPassword123' })).status, 401)
    assert.equal((await post('/auth/login', { email: 'hodan@example.edu', password: 'NewPassword123' })).status, 200)
    const after = await User.findOne({ email: 'hodan@example.edu' }).select('+passwordResetTokenHash').lean()
    assert.equal(after.passwordResetTokenHash, undefined)
    assert.equal(after.loginLock, undefined, 'lock counters cleared')
    await wait(300)
    assert.ok(outbox.some((message) => /password was changed/.test(message.subject)), 'security notice sent')

    // Single use.
    assert.equal((await (await post('/auth/reset-password', { token, password: 'Another12345' })).json()).status, 'invalid')

    // Expired link.
    await User.updateOne({ email: 'hodan@example.edu' }, { $unset: { passwordReset: 1 } })
    await post('/auth/forgot-password', { email: 'hodan@example.edu' })
    await wait(300)
    const second = tokenFrom(outbox.at(-1))
    await User.updateOne({ email: 'hodan@example.edu' }, { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1000) } })
    assert.equal((await (await post('/auth/reset-password', { token: second, password: 'Another12345' })).json()).status, 'expired')
    assert.equal((await post('/auth/login', { email: 'hodan@example.edu', password: 'NewPassword123' })).status, 200, 'password unchanged by an expired link')
  } finally {
    setEmailTransport(null)
    app.set('trust proxy', false)
    await new Promise((resolve) => server.close(resolve))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
