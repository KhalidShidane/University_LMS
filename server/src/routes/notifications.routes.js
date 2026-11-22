import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  deleteNotification, getUnreadNotificationCount, listNotifications,
  markAllNotificationsRead, markNotificationRead, streamNotifications,
} from '../controllers/notifications.controller.js'

const router = Router()
router.use(requireAuth)
router.get('/', asyncHandler(listNotifications))
router.get('/unread-count', asyncHandler(getUnreadNotificationCount))
router.get('/stream', streamNotifications)
router.patch('/read-all', asyncHandler(markAllNotificationsRead))
router.patch('/:id/read', asyncHandler(markNotificationRead))
router.delete('/:id', asyncHandler(deleteNotification))
export default router
