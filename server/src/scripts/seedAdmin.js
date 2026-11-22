import '../config/loadEnv.js'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import User from '../models/User.js'
import { hashPassword, isPasswordLengthValid } from '../services/password.service.js'

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_NAME || !ADMIN_EMAIL || ADMIN_EMAIL === 'admin@example.edu'
    || ADMIN_PASSWORD?.startsWith('replace_with_')
    || !isPasswordLengthValid(ADMIN_PASSWORD, 12)) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and a 12+ character ADMIN_PASSWORD of no more than 72 bytes in server/.env')
  }

  await connectDatabase()
  const existing = await User.findOne({ role: 'admin', email: ADMIN_EMAIL.toLowerCase() }).select('_id').lean()
  if (existing) {
    console.info('The configured administrator account already exists; no changes were made')
    return
  }

  await User.create({
    fullName: ADMIN_NAME,
    email: ADMIN_EMAIL,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: 'admin',
  })
  console.info(`Administrator account created for ${ADMIN_EMAIL}`)
}

try {
  await seedAdmin()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await disconnectDatabase().catch(() => {})
}
