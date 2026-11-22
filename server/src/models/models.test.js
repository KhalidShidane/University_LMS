import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import Faculty, { facultySchema } from './Faculty.js'
import Department, { departmentSchema } from './Department.js'
import Class, { classSchema } from './Class.js'
import User, { userSchema } from './User.js'
import Course, { courseSemesters } from './Course.js'

const BCRYPT_HASH = `$2b$12$${'A'.repeat(53)}`

test('models define timestamps and unique academic codes', () => {
  for (const schema of [facultySchema, departmentSchema, classSchema, userSchema]) {
    assert.equal(schema.options.timestamps, true)
  }
  assert.equal(facultySchema.path('code').options.unique, true)
  assert.equal(departmentSchema.path('code').options.unique, true)
  assert.equal(classSchema.path('classCode').options.unique, true)
  assert.equal(userSchema.path('email').options.unique, true)
  assert.ok(userSchema.indexes().some(([keys, options]) => keys.studentId === 1 && options.unique && options.partialFilterExpression))
})

test('courses store an academic year and default legacy records safely', () => {
  assert.equal(Course.schema.path('academicYear').options.maxlength, 20)
  assert.equal(new Course().academicYear, '')
  assert.deepEqual(courseSemesters, ['Foundation-1', 'Foundation', 'Semester-1', 'Semester-2', 'Semester-3', 'Semester-4', 'Semester-5', 'Semester-6', 'Semester-7', 'Semester-8'])
  assert.equal(new Course({ semester: 'Semester-8' }).semester, 'Semester-8')
})

test('legacy courses without a semester remain valid', async () => {
  const course = new Course({ name: 'Legacy course', courseCode: 'LEGACY', department: new mongoose.Types.ObjectId(), class: new mongoose.Types.ObjectId() })
  await assert.doesNotReject(course.validate())
})

test('academic relationships use ObjectId references', () => {
  assert.equal(departmentSchema.path('faculty').options.ref, 'Faculty')
  assert.equal(classSchema.path('department').options.ref, 'Department')
  assert.equal(userSchema.path('department').options.ref, 'Department')
  assert.equal(userSchema.path('class').options.ref, 'Class')
  assert.equal(userSchema.path('assignedClasses').caster.options.ref, 'Class')
})

test('required fields are enforced for the academic models', async () => {
  const expectations = [
    [new Faculty({}), ['name', 'code']],
    [new Department({}), ['name', 'code', 'faculty']],
    [new Class({}), ['name', 'classCode', 'department']],
  ]

  for (const [document, requiredPaths] of expectations) {
    const error = await document.validate().then(() => null, (validationError) => validationError)
    assert.ok(error instanceof mongoose.Error.ValidationError)
    for (const path of requiredPaths) assert.ok(error.errors[path], `${path} should be required`)
  }
})

test('students require a Student ID and Class', async () => {
  const student = new User({ fullName: 'Student Example', email: 'STUDENT@EXAMPLE.EDU', passwordHash: BCRYPT_HASH, role: 'student' })
  const error = await student.validate().then(() => null, (validationError) => validationError)
  assert.ok(error.errors.studentId)
  assert.ok(error.errors.class)
  assert.equal(student.email, 'student@example.edu')
})

test('teachers require a department and user roles are constrained', async () => {
  const teacher = new User({ fullName: 'Teacher Example', email: 'teacher@example.edu', passwordHash: BCRYPT_HASH, role: 'teacher' })
  const teacherError = await teacher.validate().then(() => null, (validationError) => validationError)
  assert.ok(teacherError.errors.department)

  const invalidRole = new User({ fullName: 'Example', email: 'example@university.edu', passwordHash: BCRYPT_HASH, role: 'owner' })
  const roleError = await invalidRole.validate().then(() => null, (validationError) => validationError)
  assert.ok(roleError.errors.role)
})

test('plain-text passwords are rejected and password hashes are hidden by default', async () => {
  const user = new User({ fullName: 'Example', email: 'example@university.edu', passwordHash: 'plain-text-password', role: 'admin' })
  const error = await user.validate().then(() => null, (validationError) => validationError)
  assert.ok(error.errors.passwordHash)
  assert.equal(userSchema.path('passwordHash').options.select, false)
})

test('invalid ObjectId values fail model validation', async () => {
  const user = new User({
    fullName: 'Student Example',
    email: 'student@example.edu',
    passwordHash: BCRYPT_HASH,
    role: 'student',
    studentId: 'STU-001',
    class: 'not-an-object-id',
  })
  const error = await user.validate().then(() => null, (validationError) => validationError)
  assert.ok(error.errors.class)
})

test('admin accounts do not require a department or class', async () => {
  const admin = new User({ fullName: 'Admin Example', email: 'admin@example.edu', passwordHash: BCRYPT_HASH, role: 'admin' })
  await assert.doesNotReject(admin.validate())
})
