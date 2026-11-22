import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import app from '../app.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import { hashPassword } from '../services/password.service.js'
import { setEmailTransport } from '../services/email/email.service.js'
import { currentStep, totp } from '../services/twoFactor.service.js'

test('two-step verification: setup, sign-in challenge, replay protection, recovery codes, disable, admin reset', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated two-step verification checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_2fa_test_${process.pid}_${Date.now()}`
  const previous = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET }
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'twofactor-isolated-test-secret-0123456789ab' })
  const outbox = []
  setEmailTransport({ name: 'test', async send(message) { outbox.push(message); return { providerMessageId: 'x' } } })
  app.set('trust proxy', 1)
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 2500 })
    await User.init()
    const password = 'AdminPassword123'
    const admin = await User.create({ fullName: 'Admin One', email: 'admin@example.edu', passwordHash: await hashPassword(password), role: 'admin', emailVerified: true })
    await User.create({ fullName: 'Admin Two', email: 'admin2@example.edu', passwordHash: await hashPassword(password), role: 'admin', emailVerified: true })
    const base = `http://127.0.0.1:${server.address().port}/api`
    let ip = 1
    const call = (path, { method = 'POST', body, cookie } = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${ip++}`, ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const signIn = async (email) => { const response = await call('/auth/login', { body: { email, password } }); return { response, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] } }

    // Off by default: password alone signs in; admins see it as recommended.
    const first = await signIn('admin@example.edu')
    assert.equal(first.data.user.twoFactorEnabled, false)
    const cookie = first.cookie
    const status = await (await call('/auth/2fa', { method: 'GET', cookie })).json()
    assert.deepEqual([status.enabled, status.recommended], [false, true])

    // Setup + enable with a real code from the secret.
    const setup = await (await call('/auth/2fa/setup', { cookie })).json()
    assert.match(setup.uri, /^otpauth:\/\/totp\/DARSIVO%20LMS%3Aadmin%40example\.edu\?secret=/)
    assert.match(setup.qrDataUrl, /^data:image\/svg\+xml;base64,/)
    const secret = setup.secret.replace(/\s+/g, '')
    assert.equal((await call('/auth/2fa/enable', { cookie, body: { code: '000000' } })).status, 400)
    const enabled = await (await call('/auth/2fa/enable', { cookie, body: { code: totp(secret, currentStep()) } })).json()
    assert.equal(enabled.enabled, true)
    assert.equal(enabled.recoveryCodes.length, 8)
    const stored = await User.findById(admin._id).select('+twoFactor.secret +twoFactor.recoveryCodes').lean()
    assert.notEqual(stored.twoFactor.secret, secret, 'secret is encrypted at rest')
    assert.equal(stored.twoFactor.recoveryCodes.includes(enabled.recoveryCodes[0]), false, 'recovery codes stored as hashes')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.ok(outbox.some((message) => /Two-step verification is on/.test(message.subject)))

    // Password now gives a challenge, not a session.
    const challenged = await signIn('admin@example.edu')
    assert.equal(challenged.data.twoFactorRequired, true)
    assert.equal(challenged.cookie, undefined, 'no session before the code step')
    // The code used to enable cannot be reused (replay protection).
    const replay = await call('/auth/login/2fa', { body: { challengeToken: challenged.data.challengeToken, code: totp(secret, currentStep()) } })
    assert.equal(replay.status, 401)
    assert.equal((await call('/auth/login/2fa', { body: { challengeToken: 'forged', code: '123456' } })).status, 401)
    // Recovery code works exactly once.
    const recovery = enabled.recoveryCodes[0]
    const viaRecovery = await call('/auth/login/2fa', { body: { challengeToken: challenged.data.challengeToken, code: recovery.toLowerCase() } })
    assert.equal(viaRecovery.status, 200)
    const recoveryData = await viaRecovery.json()
    assert.equal(recoveryData.recoveryCodesLeft, 7)
    assert.match(viaRecovery.headers.get('set-cookie'), /^lms_session=/)
    const again = await signIn('admin@example.edu')
    assert.equal((await call('/auth/login/2fa', { body: { challengeToken: again.data.challengeToken, code: recovery } })).status, 401, 'recovery code is single-use')

    // Next authenticator code (next time step) signs in.
    await User.updateOne({ _id: admin._id }, { $set: { 'twoFactor.lastUsedStep': currentStep() - 2 } })
    const fresh = await signIn('admin@example.edu')
    const ok = await call('/auth/login/2fa', { body: { challengeToken: fresh.data.challengeToken, code: totp(secret, currentStep()) } })
    assert.equal(ok.status, 200)
    const twoFactorCookie = ok.headers.get('set-cookie').split(';')[0]

    // Disable needs password + code.
    assert.equal((await call('/auth/2fa/disable', { cookie: twoFactorCookie, body: { password: 'wrong', code: enabled.recoveryCodes[1] } })).status, 400)
    assert.equal((await call('/auth/2fa/disable', { cookie: twoFactorCookie, body: { password, code: '111111' } })).status, 400)
    assert.equal((await call('/auth/2fa/disable', { cookie: twoFactorCookie, body: { password, code: enabled.recoveryCodes[1] } })).status, 200)
    assert.equal((await signIn('admin@example.edu')).data.twoFactorRequired, undefined, 'password-only again')

    // Wrong codes count toward the account lock.
    await call('/auth/2fa/setup', { cookie: twoFactorCookie })
    const setup2 = await User.findById(admin._id).select('+twoFactor.pendingSecret').lean()
    assert.ok(setup2.twoFactor.pendingSecret)
    const secret2 = (await (await call('/auth/2fa/setup', { cookie: twoFactorCookie })).json()).secret.replace(/\s+/g, '')
    await call('/auth/2fa/enable', { cookie: twoFactorCookie, body: { code: totp(secret2, currentStep()) } })
    const lockTry = await signIn('admin@example.edu')
    for (let i = 0; i < 9; i += 1) assert.equal((await call('/auth/login/2fa', { body: { challengeToken: lockTry.data.challengeToken, code: '000000' } })).status, 401)
    assert.equal((await call('/auth/login/2fa', { body: { challengeToken: lockTry.data.challengeToken, code: '000000' } })).status, 429, 'locked after repeated wrong codes')
    await User.updateOne({ _id: admin._id }, { $unset: { loginLock: 1 } })

    // Admin reset by another admin: removes 2FA and signs the user out everywhere.
    const other = await signIn('admin2@example.edu')
    const resetResponse = await call(`/users/${admin._id}/2fa/reset`, { cookie: other.cookie })
    assert.equal(resetResponse.status, 200)
    assert.equal((await User.findById(admin._id).lean()).twoFactor, undefined)
    assert.equal((await call('/auth/me', { method: 'GET', cookie: twoFactorCookie })).status, 401, 'existing sessions ended')
    assert.equal((await call(`/users/${other.data.user.id}/2fa/reset`, { cookie: other.cookie })).status, 400, 'cannot reset your own via admin tool')
  } finally {
    setEmailTransport(null)
    app.set('trust proxy', false)
    await new Promise((resolve) => server.close(resolve))
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
