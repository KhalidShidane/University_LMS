// Two-step verification with authenticator apps (TOTP, RFC 6238: SHA-1, 30 s, 6 digits).
// Secrets are encrypted at rest (AES-256-GCM); recovery codes are stored as hashes only.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import QRCode from 'qrcode'

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ISSUER = 'DARSIVO LMS'

export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(bytes)
}

export function totp(secretBase32, step) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 15
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString()
  return code.padStart(DIGITS, '0')
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS)

/** Returns the matching time step (allows ±1 step for clock drift), or null. */
export function verifyTotp(secretBase32, code, { now = Date.now(), lastUsedStep = -1 } = {}) {
  const digits = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  const step = currentStep(now)
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate <= lastUsedStep) continue // each code works only once
    const expected = Buffer.from(totp(secretBase32, candidate))
    if (timingSafeEqual(expected, Buffer.from(digits))) return candidate
  }
  return null
}

// Encryption key derived from the server secret (or a dedicated TWO_FACTOR_ENCRYPTION_KEY).
function key() {
  const material = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!material) throw new Error('Two-step verification is not configured')
  return Buffer.from(hkdfSync('sha256', material, 'darsivo-2fa-salt', 'totp-secret-encryption', 32))
}

export function encryptSecret(secretBase32) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptSecret(payload) {
  const [iv, tag, data] = String(payload || '').split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function newSecret() {
  return base32Encode(randomBytes(20))
}

export async function setupDetails(secretBase32, accountEmail) {
  const label = encodeURIComponent(`${ISSUER}:${accountEmail}`)
  const uri = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 200 })
  return { uri, qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`, secret: secretBase32.match(/.{1,4}/g).join(' ') }
}

const hashRecovery = (code) => createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')

/** 8 one-time recovery codes like "K7Q2-9XMA"; returns { codes, hashes }. */
export function newRecoveryCodes(count = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codes = Array.from({ length: count }, () => {
    const raw = Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join('')
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  })
  return { codes, hashes: codes.map(hashRecovery) }
}

/** Index of a matching unused recovery code hash, or -1. */
export function findRecoveryCode(hashes, code) {
  const target = hashRecovery(code)
  return (hashes || []).findIndex((hash) => hash.length === target.length && timingSafeEqual(Buffer.from(hash), Buffer.from(target)))
}

// Short-lived token proving the password step succeeded; required for the code step.
export function issueChallenge(user) {
  return jwt.sign({ sub: String(user._id), ver: Number(user.sessionVersion) || 0, purpose: '2fa' }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'university-lms' })
}

export function readChallenge(token) {
  try {
    const payload = jwt.verify(String(token || ''), process.env.JWT_SECRET, { issuer: 'university-lms' })
    return payload.purpose === '2fa' ? payload : null
  } catch {
    return null
  }
}
