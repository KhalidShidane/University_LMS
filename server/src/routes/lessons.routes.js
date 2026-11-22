import { Router } from 'express'
import multer from 'multer'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { auditMutations } from '../middleware/requestSecurity.middleware.js'
import {
  createLesson, deleteLesson, deleteLessonCover, deleteLessonMaterial,
  downloadLessonMaterial, getLessonCover, getStudentLesson, getTeacherLesson,
  listStudentLessons, listTeacherLessons, updateLesson, updateLessonStatus,
  uploadLessonCover, uploadLessonMaterials,
} from '../controllers/lessons.controller.js'

const router = Router()
const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 8 } })
router.use(requireAuth, auditMutations)

router.get('/teacher', requireRole('teacher'), asyncHandler(listTeacherLessons))
router.post('/teacher', requireRole('teacher'), asyncHandler(createLesson))
router.get('/teacher/:id', requireRole('teacher'), asyncHandler(getTeacherLesson))
router.patch('/teacher/:id', requireRole('teacher'), asyncHandler(updateLesson))
router.patch('/teacher/:id/status', requireRole('teacher'), asyncHandler(updateLessonStatus))
router.delete('/teacher/:id', requireRole('teacher'), asyncHandler(deleteLesson))
router.post('/teacher/:id/materials', requireRole('teacher'), uploads.array('files', 8), asyncHandler(uploadLessonMaterials))
router.delete('/teacher/:id/materials/:materialId', requireRole('teacher'), asyncHandler(deleteLessonMaterial))
router.post('/teacher/:id/cover', requireRole('teacher'), uploads.single('file'), asyncHandler(uploadLessonCover))
router.delete('/teacher/:id/cover', requireRole('teacher'), asyncHandler(deleteLessonCover))
router.get('/:id/cover', requireRole('teacher', 'student'), asyncHandler(getLessonCover))
router.get('/:id/materials/:materialId', requireRole('teacher', 'student'), asyncHandler(downloadLessonMaterial))
router.get('/student', requireRole('student'), asyncHandler(listStudentLessons))
router.get('/student/:id', requireRole('student'), asyncHandler(getStudentLesson))

export default router
