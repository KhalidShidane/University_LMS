import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import { LoadingScreen } from './components/ui/States.jsx'

const AuthPage = lazy(() => import('./pages/auth/AuthPage.jsx'))
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage.jsx'))
const ForgotPasswordPage = lazy(() => import('./pages/auth/PasswordResetPages.jsx').then((module) => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('./pages/auth/PasswordResetPages.jsx').then((module) => ({ default: module.ResetPasswordPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const AdminManagementPage = lazy(() => import('./pages/admin/AdminManagementPage.jsx'))
const AdminCoursesPage = lazy(() => import('./pages/admin/AdminCoursesPage.jsx'))
const TeacherWorkspacePage = lazy(() => import('./pages/teacher/TeacherWorkspacePage.jsx'))
const TeacherLessonsPage = lazy(() => import('./pages/teacher/TeacherLessonsPage.jsx'))
const TeacherClassDetailsPage = lazy(() => import('./pages/teacher/TeacherClassDetailsPage.jsx'))
const TeacherAssignmentsPage = lazy(() => import('./pages/teacher/TeacherAssignmentsPage.jsx'))
const TeacherAssignmentDetailsPage = lazy(() => import('./pages/teacher/TeacherAssignmentDetailsPage.jsx'))
const TeacherQuizzesPage = lazy(() => import('./pages/teacher/TeacherQuizzesPage.jsx'))
const StudentWorkspacePage = lazy(() => import('./pages/student/StudentWorkspacePage.jsx'))
const StudentAssignmentsPage = lazy(() => import('./pages/student/StudentAssignmentsPage.jsx'))
const StudentAssignmentDetailsPage = lazy(() => import('./pages/student/StudentAssignmentDetailsPage.jsx'))
const StudentLessonsPage = lazy(() => import('./pages/student/StudentLessonsPage.jsx'))
const StudentCourseLessonsPage = lazy(() => import('./pages/student/StudentCourseLessonsPage.jsx'))
const StudentLessonDetailsPage = lazy(() => import('./pages/student/StudentLessonDetailsPage.jsx'))
const StudentQuizzesPage = lazy(() => import('./pages/student/StudentQuizzesPage.jsx'))
const StudentNotesPage = lazy(() => import('./pages/student/StudentNotesPage.jsx'))
const MessagesPage = lazy(() => import('./pages/MessagesPage.jsx'))
const NotificationCenterPage = lazy(() => import('./pages/NotificationCenterPage.jsx'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'))
const AdminUserDetailsPage = lazy(() => import('./pages/admin/AdminUserDetailsPage.jsx'))
const AdminSystemPage = lazy(() => import('./pages/admin/AdminSystemPage.jsx'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage.jsx'))
const fallback = <LoadingScreen label="Loading workspace" />

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen label="Loading your workspace" />
  return <Navigate to={user ? '/app/dashboard' : '/login'} replace />
}

function GuestOnly() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen label="Checking your session" />
  return user ? <Navigate to="/app/dashboard" replace /> : <Outlet />
}

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingScreen label="Loading your workspace" />
  return user ? <Outlet /> : <Navigate to="/login" state={{ from: location }} replace />
}

function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  return roles.includes(user?.role) ? children : <Navigate to="/app/dashboard" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/verify-email" element={<Suspense fallback={fallback}><VerifyEmailPage /></Suspense>} />
      <Route path="/verify-email/:token" element={<Suspense fallback={fallback}><VerifyEmailPage /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={fallback}><ForgotPasswordPage /></Suspense>} />
      <Route path="/reset-password" element={<Suspense fallback={fallback}><ResetPasswordPage /></Suspense>} />
      <Route path="/reset-password/:token" element={<Suspense fallback={fallback}><ResetPasswordPage /></Suspense>} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Suspense fallback={fallback}><AuthPage mode="login" /></Suspense>} />
        <Route path="/register" element={<Suspense fallback={fallback}><AuthPage mode="register" /></Suspense>} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Suspense fallback={fallback}><DashboardPage /></Suspense>} />
          <Route path="profile" element={<Suspense fallback={fallback}><ProfilePage /></Suspense>} />
          <Route path="academic" element={<Navigate to="/app/faculties" replace />} />
          <Route path="people" element={<Navigate to="/app/students" replace />} />
          {['faculties', 'departments', 'teachers', 'students'].map((resource) => <Route key={resource} path={resource} element={<Suspense fallback={fallback}><RoleRoute roles={['admin']}><AdminManagementPage resource={resource} /></RoleRoute></Suspense>} />)}
          <Route path="semesters" element={<Suspense fallback={fallback}><RoleRoute roles={['admin']}><AdminSystemPage section="semesters" /></RoleRoute></Suspense>} />
          <Route path="announcements" element={<Suspense fallback={fallback}><RoleRoute roles={['admin', 'teacher', 'student']}><AnnouncementsPage /></RoleRoute></Suspense>} />
          <Route path="classes" element={<Suspense fallback={fallback}><ClassesByRole /></Suspense>} />
          <Route path="courses" element={<Suspense fallback={fallback}><CoursesByRole /></Suspense>} />
          <Route path="classes/:id" element={<Suspense fallback={fallback}><RoleRoute roles={['teacher']}><TeacherClassDetailsPage /></RoleRoute></Suspense>} />
          <Route path="teachers/:id" element={<Suspense fallback={fallback}><RoleRoute roles={['admin']}><AdminUserDetailsPage role="teacher" /></RoleRoute></Suspense>} />
          <Route path="students/:id" element={<Suspense fallback={fallback}><RoleRoute roles={['admin']}><AdminUserDetailsPage role="student" /></RoleRoute></Suspense>} />
          <Route path="lessons" element={<Suspense fallback={fallback}><RoleRoute roles={['teacher']}><TeacherLessonsPage /></RoleRoute></Suspense>} />
          <Route path="assignments" element={<Suspense fallback={fallback}><RoleRoute roles={['teacher', 'student']}><AssignmentsByRole /></RoleRoute></Suspense>} />
          <Route path="assignments/:id" element={<Suspense fallback={fallback}><RoleRoute roles={['teacher', 'student']}><AssignmentDetailsByRole /></RoleRoute></Suspense>} />
          <Route path="quizzes" element={<Suspense fallback={fallback}><RoleRoute roles={['teacher', 'student']}><TeacherOrStudentQuizzes /></RoleRoute></Suspense>} />
          <Route path="messages" element={<Suspense fallback={fallback}><RoleRoute roles={['admin', 'teacher', 'student']}><MessagesPage /></RoleRoute></Suspense>} />
          <Route path="messages/:conversationId" element={<Suspense fallback={fallback}><RoleRoute roles={['admin', 'teacher', 'student']}><MessagesPage /></RoleRoute></Suspense>} />
          <Route path="notifications" element={<Suspense fallback={fallback}><NotificationCenterPage /></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={fallback}><RoleRoute roles={['admin', 'teacher', 'student']}><AnalyticsPage /></RoleRoute></Suspense>} />
          {['settings', 'audit-logs', 'system-health'].map((section) => <Route key={section} path={section} element={<Suspense fallback={fallback}><RoleRoute roles={['admin']}><AdminSystemPage section={section} /></RoleRoute></Suspense>} />)}
          <Route path="notes" element={<Suspense fallback={fallback}><RoleRoute roles={['student']}><StudentNotesPage /></RoleRoute></Suspense>} />
          <Route path="learning" element={<Suspense fallback={fallback}><RoleRoute roles={['student']}><StudentLessonsPage /></RoleRoute></Suspense>} />
          <Route path="learning/courses/:courseId" element={<Suspense fallback={fallback}><RoleRoute roles={['student']}><StudentCourseLessonsPage /></RoleRoute></Suspense>} />
          <Route path="learning/courses/:courseId/lessons/:id" element={<Suspense fallback={fallback}><RoleRoute roles={['student']}><StudentLessonDetailsPage /></RoleRoute></Suspense>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function AssignmentsByRole() {
  const { user } = useAuth()
  return user.role === 'teacher'
    ? <TeacherAssignmentsPage />
    : <StudentAssignmentsPage />
}

function CoursesByRole() {
  const { user } = useAuth()
  if (user.role === 'admin') return <AdminCoursesPage />
  if (user.role === 'teacher') return <Navigate to="/app/classes" replace />
  return <Navigate to="/app/dashboard" replace />
}

function AssignmentDetailsByRole() {
  const { user } = useAuth()
  return user.role === 'teacher'
    ? <TeacherAssignmentDetailsPage />
    : <StudentAssignmentDetailsPage />
}

function TeacherOrStudentQuizzes() {
  const { user } = useAuth()
  return user.role === 'teacher'
    ? <TeacherQuizzesPage />
    : <StudentQuizzesPage />
}

function ClassesByRole() {
  const { user } = useAuth()
  if (user.role === 'admin') return <AdminManagementPage resource="classes" />
  if (user.role === 'teacher') return <TeacherWorkspacePage section="classes" />
  return <Navigate to="/app/dashboard" replace />
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
