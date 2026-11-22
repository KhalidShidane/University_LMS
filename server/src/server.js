import './config/loadEnv.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import app from './app.js'
import { connectDatabase, disconnectDatabase } from './config/db.js'
import { startAssignmentDeadlineNotifications } from './services/assignmentDeadlineNotifications.service.js'
import { closeAllNotificationStreams } from './services/notificationRealtime.service.js'
import { validateProductionConfig } from './config/securityConfig.js'
import { startEmailNotifications } from './services/emailNotifications.service.js'

export async function startServer() {
  validateProductionConfig()
  let stopDeadlineNotifications = () => {}
  try {
    await connectDatabase()
    console.info('MongoDB connected')
    const stopAssignmentReminders = startAssignmentDeadlineNotifications()
    const stopEmailNotifications = startEmailNotifications()
    stopDeadlineNotifications = () => { stopAssignmentReminders(); stopEmailNotifications() }
  } catch {
    if (process.env.NODE_ENV === 'production') {
      await disconnectDatabase().catch(() => {})
      throw new Error('MongoDB connection is required in production; API startup was aborted')
    }
    console.error('MongoDB is unavailable; starting the API with database status disconnected')
  }

  const port = Number(process.env.PORT) || 5000
  const server = app.listen(port, () => {
    console.info(`University LMS API listening on port ${port}`)
  })
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other LMS API process before restarting this server.`)
    } else {
      console.error('University LMS API could not start listening', error.code || error.message)
    }
    void disconnectDatabase().finally(() => { process.exitCode = 1 })
  })

  let isShuttingDown = false
  const shutdown = async (signal) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.info(`${signal} received; shutting down gracefully`)
    stopDeadlineNotifications()
    closeAllNotificationStreams()

    server.close(async (error) => {
      if (error) {
        console.error('HTTP server shutdown failed')
        process.exitCode = 1
      }
      try {
        await disconnectDatabase()
      } catch {
        console.error('MongoDB disconnect failed during shutdown')
        process.exitCode = 1
      }
    })
  }

  process.once('SIGINT', () => { void shutdown('SIGINT') })
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
  return server
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  startServer()
}
