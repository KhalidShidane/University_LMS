import mongoose from 'mongoose'
import { migrateLegacyEmailVerification } from '../services/emailVerification.service.js'

const CONNECTION_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function migrateCourseCodeIndex() {
  const courses = mongoose.connection.collection('courses')
  let indexes = []
  try {
    indexes = await courses.indexes()
  } catch (error) {
    if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') throw error
  }

  const oldGlobalUniqueIndex = indexes.find((index) => index.unique
    && Object.keys(index.key || {}).length === 1
    && Object.hasOwn(index.key, 'courseCode'))
  if (oldGlobalUniqueIndex) await courses.dropIndex(oldGlobalUniqueIndex.name)
  await courses.createIndex(
    { courseCode: 1, department: 1, class: 1 },
    { unique: true, partialFilterExpression: { isActive: true }, name: 'active_course_code_scope_unique' },
  )
}

export function getDatabaseStatus() {
  return CONNECTION_STATES[mongoose.connection.readyState] || 'disconnected'
}

export async function connectDatabase({
  uri = process.env.MONGODB_URI,
  attempts = 3,
  retryDelayMs = 500,
  serverSelectionTimeoutMS = 2000,
  connect = mongoose.connect.bind(mongoose),
  pause = wait,
} = {}) {
  if (!uri) {
    throw new Error('MONGODB_URI is required to connect to MongoDB')
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connect(uri, { serverSelectionTimeoutMS })
      if (mongoose.connection.readyState === 1) {
        await migrateCourseCodeIndex()
        await migrateLegacyEmailVerification()
      }
      return mongoose.connection
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await pause(Math.min(retryDelayMs * 2 ** (attempt - 1), 5000))
      }
    }
  }

  throw new Error(`MongoDB connection failed after ${attempts} attempts`, { cause: lastError })
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
}
