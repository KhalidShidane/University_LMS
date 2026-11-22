import { Router } from 'express'
import multer from 'multer'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { getStudentClasses, getStudentOverview, getStudentWeeklyLearning } from '../controllers/academic.controller.js'
import {
  submitQuizAttempt,
} from '../controllers/learning.controller.js'
import { getStudentLesson, listStudentLessons } from '../controllers/lessons.controller.js'
import { getStudentCourseLesson, listStudentCourseLessons } from '../controllers/lessons.controller.js'
import { getCourseCover, listStudentCourses } from '../controllers/courses.controller.js'
import {
  downloadAssignmentSubmission,
  getMyAssignmentSubmission,
  getStudentAssignment,
  getStudentAssignmentResult,
  listStudentAssignments,
  submitStudentAssignment,
} from '../controllers/assignments.controller.js'
import { maxSubmissionBytes } from '../services/assignmentFiles.service.js'
import {
  getStudentQuiz, getStudentQuizAttempt, getStudentQuizResult, getStudentQuizReview, listStudentQuizzesV2,
  saveStudentQuizAnswers, startStudentQuiz, submitStudentQuizAttempt,
} from '../controllers/quizzes.controller.js'
import { studentAnalyticsPerformance } from '../controllers/analytics.controller.js'
import { auditMutations } from '../middleware/requestSecurity.middleware.js'

const router = Router()
const assignmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSubmissionBytes, files: 1 },
})

router.use(requireAuth, requireRole('student'), auditMutations)
router.get('/overview', asyncHandler(getStudentOverview))
router.get('/weekly-learning', asyncHandler(getStudentWeeklyLearning))
router.get('/analytics/performance', asyncHandler(studentAnalyticsPerformance))
router.get('/classes', asyncHandler(getStudentClasses))
router.get('/courses', asyncHandler(listStudentCourses))
router.get('/courses/:id/cover', asyncHandler(getCourseCover))
router.get('/courses/:courseId/lessons', asyncHandler(listStudentCourseLessons))
router.get('/courses/:courseId/lessons/:lessonId', asyncHandler(getStudentCourseLesson))
router.get('/lessons', asyncHandler(listStudentLessons))
router.get('/lessons/:id', asyncHandler(getStudentLesson))
router.get('/assignments', asyncHandler(listStudentAssignments))
router.get('/assignments/:id', asyncHandler(getStudentAssignment))
router.post('/assignments/:id/submit', assignmentUpload.single('file'), asyncHandler(submitStudentAssignment))
router.post('/assignments/:id/submission', assignmentUpload.single('file'), asyncHandler(submitStudentAssignment))
router.get('/assignments/:id/my-submission', asyncHandler(getMyAssignmentSubmission))
router.get('/assignments/:id/result', asyncHandler(getStudentAssignmentResult))
router.get('/submissions/:id/file', asyncHandler(downloadAssignmentSubmission))
router.get('/submissions/:submissionId/download', asyncHandler(downloadAssignmentSubmission))
router.get('/quizzes', asyncHandler(listStudentQuizzesV2))
router.get('/quizzes/:id', asyncHandler(getStudentQuiz))
router.post('/quizzes/:id/start', asyncHandler(startStudentQuiz))
router.get('/quizzes/:id/attempt', asyncHandler(getStudentQuizAttempt))
router.put('/attempts/:attemptId/answers', asyncHandler(saveStudentQuizAnswers))
router.post('/attempts/:attemptId/submit', asyncHandler(submitStudentQuizAttempt))
router.get('/attempts/:attemptId/result', asyncHandler(getStudentQuizResult))
router.get('/attempts/:attemptId/review', asyncHandler(getStudentQuizReview))
router.post('/quiz-attempts/:attemptId/submit', asyncHandler(submitQuizAttempt))

export default router
