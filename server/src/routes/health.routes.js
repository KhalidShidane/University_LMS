import { Router } from 'express'
import { getDatabaseStatus } from '../config/db.js'

const router = Router()

router.get('/', (req, res) => {
  const databaseStatus = getDatabaseStatus()
  const isDatabaseConnected = databaseStatus === 'connected'

  res.status(isDatabaseConnected ? 200 : 503).json({
    success: isDatabaseConnected,
    message: isDatabaseConnected
      ? 'University LMS API is running'
      : 'University LMS API is running; database is unavailable',
    api: { status: 'ok' },
    database: { status: databaseStatus },
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  })
})

export default router
