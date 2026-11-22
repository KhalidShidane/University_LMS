// Malware scanning for uploads through ClamAV (clamd INSTREAM protocol over TCP).
// Enabled when CLAMAV_HOST is set. If the scanner is unreachable, uploads are rejected when
// CLAMAV_REQUIRED=true, otherwise accepted with a warning (so a scanner outage never blocks
// teaching). Infected files are always rejected and never written to disk.
import net from 'node:net'

const CHUNK = 64 * 1024

export const scanSettings = () => ({
  host: process.env.CLAMAV_HOST || '',
  port: Number(process.env.CLAMAV_PORT) || 3310,
  timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS) || 30000,
  required: String(process.env.CLAMAV_REQUIRED || '').toLowerCase() === 'true',
})

/** Returns { status: 'clean' | 'infected' | 'error' | 'disabled', signature?, error? } */
export function scanBuffer(buffer, settings = scanSettings()) {
  if (!settings.host) return Promise.resolve({ status: 'disabled' })
  return new Promise((resolve) => {
    let reply = ''
    let settled = false
    const done = (result) => { if (!settled) { settled = true; socket.destroy(); resolve(result) } }
    const socket = net.createConnection({ host: settings.host, port: settings.port }, () => {
      socket.write('zINSTREAM\0')
      for (let offset = 0; offset < buffer.length; offset += CHUNK) {
        const chunk = buffer.subarray(offset, offset + CHUNK)
        const size = Buffer.alloc(4)
        size.writeUInt32BE(chunk.length)
        socket.write(size)
        socket.write(chunk)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk ends the stream
    })
    socket.setTimeout(settings.timeoutMs, () => done({ status: 'error', error: 'timeout' }))
    socket.on('data', (data) => { reply += data.toString('utf8') })
    socket.on('error', (error) => done({ status: 'error', error: error.code || error.message }))
    socket.on('end', () => {
      const text = reply.replace(/\0/g, '').trim()
      if (/:\s*OK$/.test(text)) return done({ status: 'clean' })
      const found = text.match(/:\s*(.+)\s+FOUND$/)
      if (found) return done({ status: 'infected', signature: found[1] })
      return done({ status: 'error', error: text.slice(0, 120) || 'empty reply' })
    })
  })
}

/** Throws an HTTP-friendly error if the upload must not be stored. */
export async function assertFileIsSafe(buffer, fileName = 'file', settings = scanSettings()) {
  const result = await scanBuffer(buffer, settings)
  if (result.status === 'infected') {
    console.warn(`Upload blocked: ${result.signature} detected in an uploaded file`)
    throw Object.assign(new Error(`“${String(fileName).slice(0, 80)}” was blocked because it contains malware (${result.signature}).`), { status: 422, code: 'FILE_INFECTED' })
  }
  if (result.status === 'error') {
    console.error(`Malware scanner unavailable (${result.error})`)
    if (settings.required) throw Object.assign(new Error('Files cannot be uploaded right now because the security scanner is unavailable. Please try again shortly.'), { status: 503, code: 'SCANNER_UNAVAILABLE', expose: true })
  }
  return result
}
