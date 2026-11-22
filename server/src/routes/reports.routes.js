import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { exportAnalytics } from '../controllers/analytics.controller.js'

const router = Router()
router.use(requireAuth, requireRole('admin', 'teacher', 'student'))
for (const format of ['pdf', 'excel', 'csv']) {
  router.get(`/export/${format}`, (req, res, next) => {
    req.params.format = format
    return asyncHandler(exportAnalytics)(req, res, next)
  })
}

export default router
