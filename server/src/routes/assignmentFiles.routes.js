import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { downloadAssignmentAttachment, downloadAssignmentSubmission } from '../controllers/assignments.controller.js'

const router = Router()
router.get('/assignments/:id/attachments/:attachmentId/download', requireAuth, requireRole('teacher', 'student'), asyncHandler(downloadAssignmentAttachment))
router.get('/submissions/:submissionId/download', requireAuth, requireRole('teacher', 'student'), asyncHandler(downloadAssignmentSubmission))
export default router
