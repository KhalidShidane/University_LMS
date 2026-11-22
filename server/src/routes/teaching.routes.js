import { Router } from 'express'
import multer from 'multer'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { getTeachingClasses, getTeacherDashboard, getTeacherMetrics, getTeachingClassStudents } from '../controllers/academic.controller.js'
import { teacherAnalyticsClass, teacherAnalyticsOverview, teacherAnalyticsStudent } from '../controllers/analytics.controller.js'
import { listTeacherSubmissions } from '../controllers/learning.controller.js'
import { createLesson, listTeacherLessons, updateLesson } from '../controllers/lessons.controller.js'
import { getCourseCover, listTeacherCourses } from '../controllers/courses.controller.js'
import {
  addAssignmentAttachments, createTeacherAssignment, downloadAssignmentSubmission,
  getTeacherAssignment, getTeacherSubmission, gradeTeacherSubmission,
  listTeacherAssignmentSubmissions, listTeacherAssignments,
  updateTeacherAssignment, updateTeacherAssignmentStatus,
} from '../controllers/assignments.controller.js'
import { maxAssignmentAttachments, maxAttachmentBytes } from '../services/assignmentFiles.service.js'
import { auditMutations } from '../middleware/requestSecurity.middleware.js'
import {
  createTeacherQuiz, getTeacherQuiz, gradeTeacherQuizAnswer, listTeacherQuizAttempts,
  listTeacherQuizzesV2, updateTeacherQuiz, updateTeacherQuizStatus, updateQuizResults,
} from '../controllers/quizzes.controller.js'

const router = Router()
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxAttachmentBytes, files: maxAssignmentAttachments } })
router.use(requireAuth, requireRole('teacher'), auditMutations)
router.get('/overview', asyncHandler(getTeacherMetrics))
router.get('/analytics/overview', asyncHandler(teacherAnalyticsOverview))
router.get('/analytics/classes/:classId', asyncHandler(teacherAnalyticsClass))
router.get('/analytics/students/:studentId', asyncHandler(teacherAnalyticsStudent))
router.get('/dashboard', asyncHandler(getTeacherDashboard))
router.get('/classes', asyncHandler(getTeachingClasses))
router.get('/courses', asyncHandler(listTeacherCourses))
router.get('/courses/:id/cover', asyncHandler(getCourseCover))
router.get('/classes/:id/students', asyncHandler(getTeachingClassStudents))
router.get('/lessons', asyncHandler(listTeacherLessons))
router.post('/lessons', asyncHandler(createLesson))
router.patch('/lessons/:id', asyncHandler(updateLesson))
router.get('/assignments', asyncHandler(listTeacherAssignments))
router.post('/assignments', asyncHandler(createTeacherAssignment))
router.get('/assignments/:id', asyncHandler(getTeacherAssignment))
router.put('/assignments/:id', asyncHandler(updateTeacherAssignment))
router.patch('/assignments/:id', asyncHandler(updateTeacherAssignment))
router.patch('/assignments/:id/status', asyncHandler(updateTeacherAssignmentStatus))
router.get('/assignments/:id/submissions', asyncHandler(listTeacherAssignmentSubmissions))
router.post('/assignments/:id/attachments', attachmentUpload.array('files', maxAssignmentAttachments), asyncHandler(addAssignmentAttachments))
router.get('/submissions', asyncHandler(listTeacherSubmissions))
router.get('/submissions/:id', asyncHandler(getTeacherSubmission))
router.get('/submissions/:id/file', asyncHandler(downloadAssignmentSubmission))
router.get('/submissions/:submissionId/download', asyncHandler(downloadAssignmentSubmission))
router.patch('/submissions/:id/grade', asyncHandler(gradeTeacherSubmission))
router.patch('/submissions/:submissionId/grade', asyncHandler(gradeTeacherSubmission))
router.get('/quizzes', asyncHandler(listTeacherQuizzesV2))
router.post('/quizzes', asyncHandler(createTeacherQuiz))
router.get('/quizzes/:id', asyncHandler(getTeacherQuiz))
router.put('/quizzes/:id', asyncHandler(updateTeacherQuiz))
router.patch('/quizzes/:id', asyncHandler(updateTeacherQuiz))
router.patch('/quizzes/:id/status', asyncHandler(updateTeacherQuizStatus))
router.get('/quizzes/:id/attempts', asyncHandler(listTeacherQuizAttempts))
router.patch('/attempts/:attemptId/grade', asyncHandler(gradeTeacherQuizAnswer))
router.patch('/quizzes/:id/results', asyncHandler(updateQuizResults))
export default router
