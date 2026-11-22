import Assignment from '../models/Assignment.js'
import Submission from '../models/Submission.js'
import User from '../models/User.js'
import { notifyUsers } from './notifications.service.js'

const reminderWindowMs = 24 * 60 * 60 * 1000
const intervalMs = 15 * 60 * 1000

export async function sendUpcomingAssignmentReminders(now = new Date()) {
  const assignments = await Assignment.find({
    $or: [{ status: 'published' }, { status: { $exists: false }, isPublished: true }],
    dueDate: { $gt: now, $lte: new Date(now.getTime() + reminderWindowMs) },
  }).select('_id title class dueDate').lean()
  await Promise.all(assignments.map(async (assignment) => {
    const [students, submissions] = await Promise.all([
      User.find({ role: 'student', class: assignment.class, isActive: true }).select('_id').lean(),
      Submission.find({ assignment: assignment._id }).select('student').lean(),
    ])
    const submittedIds = new Set(submissions.map((submission) => String(submission.student)))
    const affectedStudents = students.map((student) => student._id).filter((studentId) => !submittedIds.has(String(studentId)))
    return notifyUsers(affectedStudents, {
      type: 'assignment_deadline',
      title: 'Assignment deadline approaching',
      message: `${assignment.title} is due ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(assignment.dueDate)}.`,
      relatedEntityType: 'assignment',
      relatedEntityId: assignment._id,
    }, `assignment-deadline:${assignment._id}`)
  }))
  return assignments.length
}

export function startAssignmentDeadlineNotifications() {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await sendUpcomingAssignmentReminders() } catch (error) { console.error('Assignment deadline reminder check failed', error.message) } finally { running = false }
  }
  void run()
  const interval = setInterval(run, intervalMs)
  interval.unref?.()
  return () => clearInterval(interval)
}
