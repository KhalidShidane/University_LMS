import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { createConversation, listConversationContacts, listConversationMessages, listConversations, markConversationRead, sendConversationMessage } from '../controllers/conversations.controller.js'

const router = Router()
router.use(requireAuth, requireRole('admin', 'teacher', 'student'))
router.get('/', asyncHandler(listConversations))
router.post('/', asyncHandler(createConversation))
router.get('/contacts', asyncHandler(listConversationContacts))
router.get('/:id/messages', asyncHandler(listConversationMessages))
router.post('/:id/messages', asyncHandler(sendConversationMessage))
router.patch('/:id/read', asyncHandler(markConversationRead))
export default router
