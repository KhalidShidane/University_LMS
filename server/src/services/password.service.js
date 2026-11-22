import bcrypt from 'bcryptjs'

export function isPasswordLengthValid(value, minimum = 8) {
  return typeof value === 'string'
    && value.length >= minimum
    && Buffer.byteLength(value, 'utf8') <= 72
}

export function hashPassword(value) {
  return bcrypt.hash(value, 12)
}

export function verifyPassword(value, hash) {
  return bcrypt.compare(value, hash)
}
