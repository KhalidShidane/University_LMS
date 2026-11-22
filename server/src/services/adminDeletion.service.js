import Faculty from '../models/Faculty.js'
import Department from '../models/Department.js'
import Class from '../models/Class.js'
import Course from '../models/Course.js'
import User from '../models/User.js'
import Lesson from '../models/Lesson.js'
import Assignment from '../models/Assignment.js'
import Quiz from '../models/Quiz.js'
import Submission from '../models/Submission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import Notification from '../models/Notification.js'
import { deleteLessonFiles, deleteLessonFile } from './lessonStorage.service.js'
import { assignmentFilePath, submissionFilePath, removeStoredFile } from './assignmentFiles.service.js'

const uniqueIds = (ids) => [...new Set(ids.filter(Boolean).map(String))]

async function removeAssignments(records) {
  if (!records.length) return
  const ids = records.map((record) => record._id)
  const submissions = await Submission.find({ assignment: { $in: ids } }).lean()
  const files = submissions.flatMap((submission) => [
    submissionFilePath(submission.storedName),
    ...(submission.fileHistory || []).map((item) => submissionFilePath(item.storedName)),
  ])
  files.push(...records.flatMap((record) => (record.attachments || []).map((item) => assignmentFilePath(item.storedName))))
  await Promise.all(files.map(removeStoredFile))
  await Submission.collection.deleteMany({ assignment: { $in: ids } })
  await Assignment.collection.deleteMany({ _id: { $in: ids } })
}

async function removeLessons(records) {
  if (!records.length) return
  const ids = records.map((record) => record._id)
  await Promise.all(records.map(deleteLessonFiles))
  const assignments = await Assignment.find({ lesson: { $in: ids } }).lean()
  await removeAssignments(assignments)
  await Lesson.collection.deleteMany({ _id: { $in: ids } })
}

async function removeQuizzes(records) {
  if (!records.length) return
  const ids = records.map((record) => record._id)
  await QuizAttempt.collection.deleteMany({ quiz: { $in: ids } })
  await Quiz.collection.deleteMany({ _id: { $in: ids } })
}

async function removeUsers(ids) {
  const userIds = uniqueIds(ids)
  if (!userIds.length) return 0
  const users = await User.find({ _id: { $in: userIds }, role: { $in: ['teacher', 'student'] } }).select('_id role').lean()
  const validIds = users.map((user) => user._id)
  if (!validIds.length) return 0
  const teacherIds = users.filter((user) => user.role === 'teacher').map((user) => user._id)
  const [lessons, authoredAssignments, quizzes] = await Promise.all([
    Lesson.find({ createdBy: { $in: teacherIds } }).lean(),
    Assignment.find({ createdBy: { $in: teacherIds } }).lean(),
    Quiz.find({ createdBy: { $in: teacherIds } }).lean(),
  ])
  const lessonIds = lessons.map((lesson) => lesson._id)
  const attachedAssignments = lessonIds.length ? await Assignment.find({ lesson: { $in: lessonIds } }).lean() : []
  const assignmentMap = new Map([...authoredAssignments, ...attachedAssignments].map((record) => [String(record._id), record]))
  const assignmentRecords = [...assignmentMap.values()]
  await Promise.all([
    removeLessons(lessons),
    removeAssignments(assignmentRecords.filter((assignment) => !lessonIds.some((id) => String(id) === String(assignment.lesson)))),
    removeQuizzes(quizzes),
  ])

  const conversations = await Conversation.find({ participants: { $in: validIds } }).select('_id').lean()
  const conversationIds = conversations.map((conversation) => conversation._id)
  if (conversationIds.length) {
    await Message.collection.deleteMany({ conversationId: { $in: conversationIds } })
    await Conversation.collection.deleteMany({ _id: { $in: conversationIds } })
  }
  const submissions = await Submission.find({ student: { $in: validIds } }).lean()
  await Promise.all(submissions.flatMap((submission) => [
    removeStoredFile(submissionFilePath(submission.storedName)),
    ...(submission.fileHistory || []).map((item) => removeStoredFile(submissionFilePath(item.storedName))),
  ]))
  await Promise.all([
    Submission.collection.deleteMany({ student: { $in: validIds } }),
    QuizAttempt.collection.deleteMany({ student: { $in: validIds } }),
    Course.collection.updateMany({ students: { $in: validIds } }, { $pull: { students: { $in: validIds } } }),
    Course.collection.updateMany({ teacher: { $in: validIds } }, { $set: { teacher: null } }),
    Notification.collection.deleteMany({ $or: [{ recipientId: { $in: validIds } }, { senderId: { $in: validIds } }] }),
    Submission.collection.updateMany({ gradedBy: { $in: validIds } }, { $set: { gradedBy: null }, $pull: { gradeHistory: { gradedBy: { $in: validIds } } } }),
  ])
  await User.collection.deleteMany({ _id: { $in: validIds } })
  return validIds.length
}

async function removeClasses(classIds) {
  const ids = uniqueIds(classIds)
  if (!ids.length) return
  const [students, courses, lessons, assignments, quizzes] = await Promise.all([
    User.find({ role: 'student', class: { $in: ids } }).select('_id').lean(),
    Course.find({ class: { $in: ids } }).lean(),
    Lesson.find({ class: { $in: ids } }).lean(),
    Assignment.find({ class: { $in: ids } }).lean(),
    Quiz.find({ class: { $in: ids } }).lean(),
  ])
  await removeUsers(students.map((student) => student._id))
  await User.collection.updateMany({ assignedClasses: { $in: ids } }, { $pull: { assignedClasses: { $in: ids } } })
  const courseIds = courses.map((course) => course._id)
  const courseLessons = courseIds.length ? await Lesson.find({ course: { $in: courseIds } }).lean() : []
  const lessonMap = new Map([...lessons, ...courseLessons].map((lesson) => [String(lesson._id), lesson]))
  const lessonsToRemove = [...lessonMap.values()]
  await removeLessons(lessonsToRemove)
  const lessonSet = new Set(lessonsToRemove.map((lesson) => String(lesson._id)))
  const lessonAssignments = lessonSet.size ? await Assignment.find({ lesson: { $in: [...lessonSet] } }).lean() : []
  const allAssignments = new Map([...assignments, ...lessonAssignments].map((record) => [String(record._id), record]))
  await removeAssignments([...allAssignments.values()])
  await removeQuizzes(quizzes)
  await Promise.all(courses.map((course) => course.coverImage?.storedName ? deleteLessonFile(course.coverImage.storedName) : Promise.resolve()))
  await Course.collection.deleteMany({ _id: { $in: courseIds } })
  const conversations = await Conversation.find({ classId: { $in: ids } }).select('_id').lean()
  const conversationIds = conversations.map((conversation) => conversation._id)
  if (conversationIds.length) {
    await Message.collection.deleteMany({ conversationId: { $in: conversationIds } })
    await Conversation.collection.deleteMany({ _id: { $in: conversationIds } })
  }
  await Class.collection.deleteMany({ _id: { $in: ids } })
}

export async function deleteManagedRecord(type, id) {
  if (type === 'teachers' || type === 'students') {
    const user = await User.findOne({ _id: id, role: type === 'teachers' ? 'teacher' : 'student' }).select('_id').lean()
    if (!user) return false
    await removeUsers([user._id])
    return true
  }
  if (type === 'classes') {
    const record = await Class.findById(id).select('_id').lean()
    if (!record) return false
    await removeClasses([record._id])
    return true
  }
  if (type === 'departments') {
    const department = await Department.findById(id).select('_id').lean()
    if (!department) return false
    const [classes, teachers] = await Promise.all([
      Class.find({ department: department._id }).select('_id').lean(),
      User.find({ role: 'teacher', department: department._id }).select('_id').lean(),
    ])
    await removeUsers(teachers.map((teacher) => teacher._id))
    await removeClasses(classes.map((record) => record._id))
    await Department.collection.deleteOne({ _id: department._id })
    return true
  }
  if (type === 'faculties') {
    const faculty = await Faculty.findById(id).select('_id').lean()
    if (!faculty) return false
    const departments = await Department.find({ faculty: faculty._id }).select('_id').lean()
    for (const department of departments) await deleteManagedRecord('departments', department._id)
    await Faculty.collection.deleteOne({ _id: faculty._id })
    return true
  }
  return null
}
