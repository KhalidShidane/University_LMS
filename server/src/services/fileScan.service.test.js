import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { assertFileIsSafe, scanBuffer } from './fileScan.service.js'

// Minimal clamd stand-in: reads the INSTREAM chunks and answers like clamd.
function fakeClamd(decide) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0)
    let header = false
    const chunks = []
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      if (!header) {
        const end = buffer.indexOf(0)
        if (end < 0) return
        assert.equal(buffer.subarray(0, end).toString(), 'zINSTREAM')
        buffer = buffer.subarray(end + 1)
        header = true
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0)
        if (size === 0) { socket.end(`stream: ${decide(Buffer.concat(chunks))}\0`); return }
        if (buffer.length < 4 + size) return
        chunks.push(buffer.subarray(4, 4 + size))
        buffer = buffer.subarray(4 + size)
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

test('upload scanning: clean, infected (EICAR), large streams, scanner outage policy', async () => {
  const server = await fakeClamd((content) => (content.toString().includes('EICAR-STANDARD') ? 'Eicar-Test-Signature FOUND' : 'OK'))
  const settings = { host: '127.0.0.1', port: server.address().port, timeoutMs: 2000, required: false }
  try {
    assert.deepEqual(await scanBuffer(Buffer.from('%PDF-1.4 hello'), settings), { status: 'clean' })
    assert.deepEqual(await scanBuffer(Buffer.alloc(300 * 1024, 7), settings), { status: 'clean' }, 'multi-chunk stream')
    const infected = await scanBuffer(Buffer.from(EICAR), settings)
    assert.deepEqual(infected, { status: 'infected', signature: 'Eicar-Test-Signature' })
    await assert.rejects(() => assertFileIsSafe(Buffer.from(EICAR), 'virus.pdf', settings), (error) => error.status === 422 && error.code === 'FILE_INFECTED' && /virus\.pdf/.test(error.message))
    assert.equal((await assertFileIsSafe(Buffer.from('fine'), 'ok.pdf', settings)).status, 'clean')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  // Scanner unreachable: accepted with a warning by default, rejected when required.
  const down = { host: '127.0.0.1', port: 1, timeoutMs: 1000, required: false }
  assert.equal((await assertFileIsSafe(Buffer.from('x'), 'a.pdf', down)).status, 'error')
  await assert.rejects(() => assertFileIsSafe(Buffer.from('x'), 'a.pdf', { ...down, required: true }), (error) => error.status === 503 && error.expose === true)
  // Disabled when no host is configured.
  assert.deepEqual(await scanBuffer(Buffer.from('x'), { host: '' }), { status: 'disabled' })
})
