import test from 'node:test'
import assert from 'node:assert/strict'
import { connectDatabase, getDatabaseStatus } from './db.js'

test('database connection retries with backoff and returns after connecting', async () => {
  let calls = 0
  const delays = []
  const result = await connectDatabase({
    uri: 'mongodb://example.test/university_lms',
    attempts: 3,
    retryDelayMs: 10,
    connect: async () => {
      calls += 1
      if (calls < 3) throw new Error('temporary failure')
    },
    pause: async (milliseconds) => delays.push(milliseconds),
  })

  assert.equal(calls, 3)
  assert.deepEqual(delays, [10, 20])
  assert.equal(result, (await import('mongoose')).default.connection)
})

test('database connection reports a missing URI without attempting to connect', async () => {
  await assert.rejects(
    connectDatabase({ uri: '', connect: async () => assert.fail('should not connect') }),
    /MONGODB_URI is required/,
  )
})

test('database connection reports exhausted retries without leaking the driver error', async () => {
  let calls = 0
  await assert.rejects(
    connectDatabase({
      uri: 'mongodb://example.test/university_lms',
      attempts: 2,
      connect: async () => { calls += 1; throw new Error('private driver details') },
      pause: async () => {},
    }),
    (error) => {
      assert.match(error.message, /failed after 2 attempts/)
      assert.equal(error.cause.message, 'private driver details')
      return true
    },
  )
  assert.equal(calls, 2)
})

test('database status exposes a safe connection state', () => {
  assert.equal(getDatabaseStatus(), 'disconnected')
})
