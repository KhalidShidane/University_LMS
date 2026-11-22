import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import { hashPassword } from '../services/password.service.js'

test('login protection: per-account lockout, per-client limiter, timing-safe unknown emails', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated security hardening checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_security_test_${process.pid}_${Date.now()}`
  const previous = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET }
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'security-isolated-test-secret-0123456789abcd' })
  app.set('trust proxy', 1)
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await User.init()
    await User.create({ fullName: 'Admin', email: 'admin@example.edu', passwordHash: await hashPassword('CorrectPassword1'), role: 'admin', emailVerified: true })
    const base = `http://127.0.0.1:${server.address().port}/api`
    let ip = 1
    const login = (email, password, clientIp = `198.51.100.${ip++}`) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp }, body: JSON.stringify({ email, password }) })

    // Per-client limiter: 8 failed attempts for one email from one client, then 429.
    const statuses = []
    for (let i = 0; i < 10; i += 1) statuses.push((await login('someone@example.edu', `wrong${i}pass`, '203.0.113.9')).status)
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 429, 429])
    const limited = await login('someone@example.edu', 'wrongpass', '203.0.113.9')
    assert.equal((await limited.json()).code, 'TOO_MANY_ATTEMPTS')
    assert.equal((await login('other@example.edu', 'wrongpass', '203.0.113.9')).status, 401, 'other emails from the same client are not blocked')

    // Successful sign-ins reset the counter.
    for (let i = 0; i < 3; i += 1) assert.equal((await login('admin@example.edu', 'BadPassword1')).status, 401)
    assert.equal((await User.findOne({ email: 'admin@example.edu' }).lean()).loginLock.failures, 3)
    assert.equal((await login('admin@example.edu', 'CorrectPassword1')).status, 200)
    assert.equal((await User.findOne({ email: 'admin@example.edu' }).lean()).loginLock, undefined, 'counter cleared after success')

    // Per-account lockout: 10 failures (from different clients) lock the account, even for the right password.
    for (let i = 0; i < 9; i += 1) assert.equal((await login('admin@example.edu', `Bad${i}Password`)).status, 401)
    const tenth = await login('admin@example.edu', 'BadPassword10')
    assert.equal(tenth.status, 429)
    assert.equal((await tenth.json()).code, 'ACCOUNT_LOCKED')
    const whileLocked = await login('admin@example.edu', 'CorrectPassword1')
    assert.equal(whileLocked.status, 429, 'correct password is refused while locked')
    assert.match((await whileLocked.json()).message, /locked for \d+ minute/)
    const lockedUser = await User.findOne({ email: 'admin@example.edu' }).lean()
    assert.ok(lockedUser.loginLock.until > new Date())

    // Lock expires: sign-in works again and the lock is cleared.
    await User.updateOne({ email: 'admin@example.edu' }, { $set: { 'loginLock.until': new Date(Date.now() - 1000) } })
    assert.equal((await login('admin@example.edu', 'CorrectPassword1')).status, 200)
    assert.equal((await User.findOne({ email: 'admin@example.edu' }).lean()).loginLock, undefined)

    // Unknown emails get the same answer and still pay the bcrypt cost (no timing shortcut).
    const started = Date.now()
    const unknown = await login('does-not-exist@example.edu', 'Whatever123')
    assert.equal(unknown.status, 401)
    assert.equal((await unknown.json()).message, 'Email or password is incorrect')
    assert.ok(Date.now() - started > 50, 'unknown email still runs a password hash check')
  } finally {
    app.set('trust proxy', false)
    await new Promise((resolve) => server.close(resolve))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
