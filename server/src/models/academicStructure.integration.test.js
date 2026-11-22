import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import Faculty from './Faculty.js'
import Department from './Department.js'
import Class from './Class.js'
import User from './User.js'
import { deactivateAcademicRecord } from '../services/academicStructure.service.js'
import app from '../app.js'

const BCRYPT_HASH = `$2b$12$${'A'.repeat(53)}`

test('MongoDB academic hierarchy, unique indexes, population, and safe deactivation', {
  skip: !process.env.MONGODB_TEST_URI && 'Set MONGODB_TEST_URI to run isolated MongoDB integration checks',
}, async () => {
  const testUri = new URL(process.env.MONGODB_TEST_URI)
  testUri.pathname = `/university_lms_test_${process.pid}_${Date.now()}`

  try {
    await connectDatabase({ uri: testUri.toString(), attempts: 1, serverSelectionTimeoutMS: 1500 })
    await Promise.all([Faculty.init(), Department.init(), Class.init(), User.init()])

    const uniqueSuffix = `${process.pid % 10000}_${Date.now().toString().slice(-6)}`
    const faculty = await Faculty.create({ name: 'Integration Faculty', code: `IF_${uniqueSuffix}` })
    const department = await Department.create({ name: 'Integration Department', code: `ID_${uniqueSuffix}`, faculty: faculty._id })
    const firstClass = await Class.create({ name: 'Integration Class One', classCode: `IC1_${uniqueSuffix}`, department: department._id })
    const secondClass = await Class.create({ name: 'Integration Class Two', classCode: `IC2_${uniqueSuffix}`, department: department._id })
    const otherDepartment = await Department.create({ name: 'Other Integration Department', code: `OD_${uniqueSuffix}`, faculty: faculty._id })
    const otherDepartmentClass = await Class.create({ name: 'Other Department Class', classCode: `OC_${uniqueSuffix}`, department: otherDepartment._id })

    await assert.rejects(
      Department.create({ name: 'Missing Faculty', code: `MF_${uniqueSuffix}`, faculty: new mongoose.Types.ObjectId() }),
      /faculty references do not exist/,
    )
    await assert.rejects(
      Class.create({ name: 'Missing Department', classCode: `MD_${uniqueSuffix}`, department: new mongoose.Types.ObjectId() }),
      /department references do not exist/,
    )
    await assert.rejects(
      User.create({
        fullName: 'Teacher In Wrong Department',
        email: `wrong_department_${uniqueSuffix}@example.edu`,
        passwordHash: BCRYPT_HASH,
        role: 'teacher',
        department: department._id,
        assignedClasses: [otherDepartmentClass._id],
      }),
      /Teacher classes must belong to the assigned department/,
    )
    await assert.rejects(
      User.create({
        fullName: 'Student In Missing Class',
        email: `missing_class_${uniqueSuffix}@example.edu`,
        passwordHash: BCRYPT_HASH,
        role: 'student',
        studentId: `MIS_${uniqueSuffix}`,
        class: new mongoose.Types.ObjectId(),
      }),
      /class references do not exist/,
    )

    const teacher = await User.create({
      fullName: 'Integration Teacher',
      email: `teacher_${uniqueSuffix}@example.edu`,
      passwordHash: BCRYPT_HASH,
      role: 'teacher',
      department: department._id,
      assignedClasses: [firstClass._id, secondClass._id],
    })
    const student = await User.create({
      fullName: 'Integration Student',
      email: `student_${uniqueSuffix}@example.edu`,
      passwordHash: BCRYPT_HASH,
      role: 'student',
      studentId: `STU_${uniqueSuffix}`,
      class: firstClass._id,
    })

    const populatedTeacher = await User.findById(teacher._id).populate('assignedClasses').exec()
    const populatedStudent = await User.findById(student._id)
      .populate({ path: 'class', populate: { path: 'department', populate: { path: 'faculty' } } })
      .exec()
    assert.equal(populatedTeacher.assignedClasses.length, 2)
    assert.equal(populatedStudent.class.department.faculty.code, faculty.code)
    assert.equal(Object.hasOwn(await User.findById(teacher._id).exec(), 'passwordHash'), false)

    const healthServer = app.listen(0)
    await new Promise((resolve) => healthServer.once('listening', resolve))
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${healthServer.address().port}/api/health`)
      const healthBody = await healthResponse.json()
      assert.equal(healthResponse.status, 200)
      assert.equal(healthBody.database.status, 'connected')
      assert.equal(healthBody.api.status, 'ok')
    } finally {
      await new Promise((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()))
    }

    await assert.rejects(
      Faculty.create({ name: 'Duplicate Faculty Code', code: faculty.code }),
      (error) => error.code === 11000,
    )
    await assert.rejects(
      Department.create({ name: 'Duplicate Department Code', code: department.code, faculty: faculty._id }),
      (error) => error.code === 11000,
    )
    await assert.rejects(
      Class.create({ name: 'Duplicate Class Code', classCode: firstClass.classCode, department: department._id }),
      (error) => error.code === 11000,
    )
    await assert.rejects(
      User.create({ fullName: 'Duplicate Email', email: teacher.email, passwordHash: BCRYPT_HASH, role: 'admin' }),
      (error) => error.code === 11000,
    )
    await assert.rejects(
      User.create({
        fullName: 'Duplicate Student ID',
        email: `second_${uniqueSuffix}@example.edu`,
        passwordHash: BCRYPT_HASH,
        role: 'student',
        studentId: student.studentId,
        class: firstClass._id,
      }),
      (error) => error.code === 11000,
    )

    await assert.rejects(
      Faculty.findByIdAndDelete(faculty._id).exec(),
      { name: 'AcademicRecordInUseError' },
    )
    await assert.rejects(
      Department.findByIdAndDelete(department._id).exec(),
      { name: 'AcademicRecordInUseError' },
    )
    await assert.rejects(
      Class.findByIdAndDelete(firstClass._id).exec(),
      { name: 'AcademicRecordInUseError' },
    )
    const deactivatedClass = await deactivateAcademicRecord('class', secondClass._id)
    assert.equal(deactivatedClass.isActive, false)
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await disconnectDatabase()
  }
})
