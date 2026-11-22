import './config/loadEnv.js'
import { sessionSubject } from './middleware/auth.middleware.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import healthRoutes from './routes/health.routes.js'
import authRoutes from './routes/auth.routes.js'
import publicAcademicRoutes from './routes/publicAcademic.routes.js'
import adminRoutes from './routes/admin.routes.js'
import teachingRoutes from './routes/teaching.routes.js'
import learningRoutes from './routes/learning.routes.js'
import profileRoutes from './routes/profile.routes.js'
import lessonRoutes from './routes/lessons.routes.js'
import assignmentFilesRoutes from './routes/assignmentFiles.routes.js'
import notificationRoutes from './routes/notifications.routes.js'
import conversationRoutes from './routes/conversations.routes.js'
import reportsRoutes from './routes/reports.routes.js'
import notesRoutes from './routes/notes.routes.js'
import { notFound, errorHandler } from './middleware/error.middleware.js'
import { preventNoSqlInjection, protectCookieRequests } from './middleware/requestSecurity.middleware.js'
import { isAllowedClientOrigin } from './config/securityConfig.js'

const app = express()
const notesPath = '/api/student/notes'
const isNotesRequest = (req) => req.path === notesPath || req.path.startsWith(`${notesPath}/`)
const defaultJsonBody = express.json({ limit: '25kb' })
// Long-form rich-text notes need a larger body than the rest of the API.
const notesJsonBody = express.json({ limit: '2mb' })

app.disable('x-powered-by')
app.set('trust proxy', ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase()) ? 1 : false)
app.use(helmet())
app.use(cors({ origin: (origin, callback) => callback(null, !origin || isAllowedClientOrigin(origin)), credentials: true }))
app.use((req, res, next) => (isNotesRequest(req) ? notesJsonBody : defaultJsonBody)(req, res, next))
app.use(cookieParser())
app.use(preventNoSqlInjection)
app.use(protectCookieRequests)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  // Signed-in users get their own budget (students on one campus network often share an IP);
  // anonymous traffic is limited per client address.
  keyGenerator: (req) => { const userId = sessionSubject(req); return userId ? `user:${userId}` : `ip:${req.ip}` },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Notes have their own per-student limiter (see notes.routes.js).
  skip: (req) => process.env.NODE_ENV === 'test' || isNotesRequest(req),
  message: { success: false, message: 'The system is temporarily busy. Please try again shortly.' },
}))

app.use('/api/health', healthRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/academic', publicAcademicRoutes)
app.use('/api', adminRoutes)
app.use('/api/teacher', teachingRoutes)
app.use(notesPath, notesRoutes)
app.use('/api/student', learningRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/lessons', lessonRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api', assignmentFilesRoutes)
app.use(notFound)
app.use(errorHandler)

export default app
