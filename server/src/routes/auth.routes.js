import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { currentSession, login, logout, registerStudent } from '../controllers/auth.controller.js'

const router = Router()
router.post('/login', asyncHandler(login))
router.post('/register', asyncHandler(registerStudent))
router.post('/logout', requireAuth, asyncHandler(logout))
router.get('/me', requireAuth, asyncHandler(currentSession))

export default router
