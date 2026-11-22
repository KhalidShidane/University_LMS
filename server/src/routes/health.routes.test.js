import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../app.js'

test('health endpoint reports API availability and disconnected database status safely', async (context) => {
  const server = app.listen(0)
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}/api/health`)
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.equal(body.success, false)
  assert.equal(body.api.status, 'ok')
  assert.equal(body.database.status, 'disconnected')
  assert.equal(typeof body.environment, 'string')
  assert.ok(Number.isFinite(Date.parse(body.timestamp)))
  assert.equal(JSON.stringify(body).includes('mongodb://'), false)
})
