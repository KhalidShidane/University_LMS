import { Router } from 'express'
import multer from 'multer'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import {
  createAcademicRecord,
  deleteAdminManagedRecord,
  createTeacher,
  getAcademicRecord,
  getDashboardStats,
  getStudent,
  getTeacher,
  listAcademicRecords,
  listStudents,
  listTeachers,
  resetTeacherPassword,
  resetStudentPassword,
  updateAcademicRecord,
  updateAcademicStatus,
  updateManagedUserStatus,
  updateStudent,
  updateTeacher,
  updateTeacherClasses,
} from '../controllers/adminManagement.controller.js'
import { adminAnalyticsDirectory, adminAnalyticsOverview, adminAnalyticsPerformance } from '../controllers/analytics.controller.js'
import { exportAuditLogs, getAuditLog, getSystemHealth, getSystemSettings, listAuditLogs, updateSystemSettings } from '../controllers/systemAdmin.controller.js'
import { recordAudit } from '../services/auditLog.service.js'
import { assignCourseTeacher, createAdminCourse, deleteAdminCourse, getCourseCover, listAdminCourses, updateAdminCourseStatus, updateCourseStudent } from '../controllers/courses.controller.js'
import { downloadAcademicTemplate, importAcademicRows } from '../controllers/academicImport.controller.js'
import { createAnnouncement, listAnnouncements } from '../controllers/announcements.controller.js'

const router = Router()
const courseCoverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } })
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const adminOnly = [requireAuth, requireRole('admin')]
function auditAdminMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (req.path === '/admin/settings' || req.path === '/admin/audit-logs/export') return next()
  res.once('finish', () => {
    if (res.statusCode >= 400) return
    const parts = req.path.split('/').filter(Boolean)
    const resourceType = parts[0] === 'admin' ? parts[1] || 'system' : parts[0] || 'system'
    const verb = req.method === 'POST' ? 'created' : req.method === 'DELETE' ? 'deleted' : req.path.endsWith('/status') ? 'status.changed' : 'updated'
    recordAudit(req, { action: `${resourceType}.${verb}`, resourceType, resourceId: req.params.id || '', metadata: { method: req.method } })
  })
  return next()
}
const protect = (handler) => [...adminOnly, auditAdminMutation, asyncHandler(handler)]
router.get('/announcements', requireAuth, requireRole('admin', 'teacher', 'student'), asyncHandler(listAnnouncements))
router.post('/announcements', ...adminOnly, auditAdminMutation, asyncHandler(createAnnouncement))
const protectType = (type, handler) => [...adminOnly, auditAdminMutation, (req, res, next) => {
  req.params.type = type
  return asyncHandler(handler)(req, res, next)
}]

router.get('/admin/settings', ...protect(getSystemSettings))
router.put('/admin/settings', ...protect(updateSystemSettings))
router.get('/admin/audit-logs/export', ...protect(exportAuditLogs))
router.get('/admin/audit-logs', ...protect(listAuditLogs))
router.get('/admin/audit-logs/:id', ...protect(getAuditLog))
router.get('/admin/system-health', ...protect(getSystemHealth))
router.get('/admin/import/:type/template', ...protect(downloadAcademicTemplate))
router.post('/admin/import/:type', ...adminOnly, auditAdminMutation, excelUpload.single('file'), asyncHandler(importAcademicRows))

router.get('/admin/dashboard/stats', ...protect(getDashboardStats))
router.get('/admin/courses', ...protect(listAdminCourses))
router.post('/admin/courses', ...adminOnly, auditAdminMutation, courseCoverUpload.single('cover'), asyncHandler(createAdminCourse))
router.patch('/admin/courses/:id/status', ...protect(updateAdminCourseStatus))
router.delete('/admin/courses/:id', ...protect(deleteAdminCourse))
router.get('/admin/courses/:id/cover', ...protect(getCourseCover))
router.patch('/admin/courses/:id/teacher', ...protect(assignCourseTeacher))
router.patch('/admin/courses/:id/students', ...protect(updateCourseStudent))
router.get('/admin/analytics/overview', ...protect(adminAnalyticsOverview))
router.get('/admin/analytics/students', ...protect((req, res) => { req.params.type = 'students'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/teachers', ...protect((req, res) => { req.params.type = 'teachers'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/faculties', ...protect((req, res) => { req.params.type = 'faculties'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/departments', ...protect((req, res) => { req.params.type = 'departments'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/classes', ...protect((req, res) => { req.params.type = 'classes'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/performance', ...protect(adminAnalyticsPerformance))
router.get('/admin/analytics/assignments', ...protect((req, res) => { req.params.type = 'assignments'; return adminAnalyticsDirectory(req, res) }))
router.get('/admin/analytics/quizzes', ...protect((req, res) => { req.params.type = 'quizzes'; return adminAnalyticsDirectory(req, res) }))

for (const type of ['faculties', 'departments', 'classes']) {
  router.get(`/${type}`, ...protectType(type, listAcademicRecords))
  router.post(`/${type}`, ...protectType(type, createAcademicRecord))
  router.get(`/${type}/:id`, ...protectType(type, getAcademicRecord))
  router.put(`/${type}/:id`, ...protectType(type, updateAcademicRecord))
  router.delete(`/${type}/:id`, ...protectType(type, deleteAdminManagedRecord))
  router.patch(`/${type}/:id/status`, ...protectType(type, updateAcademicStatus))
}

router.get('/teachers', ...protect(listTeachers))
router.post('/teachers', ...protect(createTeacher))
router.get('/teachers/:id', ...protect(getTeacher))
router.put('/teachers/:id', ...protect(updateTeacher))
router.delete('/teachers/:id', ...protect((req, res) => { req.params.type = 'teachers'; return deleteAdminManagedRecord(req, res) }))
router.patch('/teachers/:id/status', ...protect(updateManagedUserStatus))
router.patch('/teachers/:id/classes', ...protect(updateTeacherClasses))
router.patch('/teachers/:id/password', ...protect(resetTeacherPassword))

router.get('/students', ...protect(listStudents))
router.get('/students/:id', ...protect(getStudent))
router.put('/students/:id', ...protect(updateStudent))
router.delete('/students/:id', ...protect((req, res) => { req.params.type = 'students'; return deleteAdminManagedRecord(req, res) }))
router.patch('/students/:id/status', ...protect(updateManagedUserStatus))
router.patch('/students/:id/password', ...protect(resetStudentPassword))

export default router
