import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedClientOrigins, isAllowedClientOrigin, validateProductionConfig } from './securityConfig.js'

test('production origin allowlist omits development localhost fallback', () => {
  assert.deepEqual(allowedClientOrigins({ nodeEnv: 'production', clientUrl: 'https://lms.example.edu', clientOrigin: '' }), ['https://lms.example.edu'])
  assert.deepEqual(allowedClientOrigins({ nodeEnv: 'development', clientUrl: '', clientOrigin: '' }), ['http://localhost:5173'])
})

test('development permits loopback frontend origins on Vite fallback ports only', () => {
  assert.equal(isAllowedClientOrigin('http://localhost:5174', { nodeEnv: 'development' }), true)
  assert.equal(isAllowedClientOrigin('http://127.0.0.1:4173', { nodeEnv: 'development' }), true)
  assert.equal(isAllowedClientOrigin('https://attacker.example', { nodeEnv: 'development' }), false)
  assert.equal(isAllowedClientOrigin('http://localhost:5174', { nodeEnv: 'production', clientUrl: 'https://lms.example.edu' }), false)
})

test('production config requires secure server secrets and HTTPS origins', () => {
  const valid = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://cluster.example.edu/lms', JWT_SECRET: 'strong-random-secret-that-is-at-least-32-chars', CLIENT_URL: 'https://lms.example.edu', PORT: '5001', JWT_EXPIRES_IN: '12h' }
  assert.doesNotThrow(() => validateProductionConfig(valid))
  assert.throws(() => validateProductionConfig({ ...valid, JWT_SECRET: 'short', CLIENT_URL: 'http://localhost:5173' }), /JWT_SECRET.*HTTPS origins/)
  assert.throws(() => validateProductionConfig({ ...valid, MONGODB_URI: '' }), /MONGODB_URI/)
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development' }))
})
