import { Router } from 'express'
import asyncHandler from '../middleware/asyncHandler.js'
import { getAcademicOptions } from '../controllers/academic.controller.js'

const router = Router()
router.get('/options', asyncHandler(getAcademicOptions))
export default router
