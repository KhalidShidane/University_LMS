import Class from '../models/Class.js'
import Course from '../models/Course.js'
import { courseSemesters as defaultCourseSemesters } from '../config/academicSemesters.js'
import Department from '../models/Department.js'
import { createExcelTemplate, parseExcelRows } from '../services/excelWorkbook.service.js'
import { loadSystemSettings } from '../services/systemSettings.service.js'

const templates = {
  classes: { headers: ['name', 'classCode', 'departmentCode', 'level', 'description'], sheet: 'Classes', filename: 'classes-template.xlsx' },
  courses: { headers: ['name', 'courseCode', 'semester', 'departmentCode', 'classCode', 'description'], sheet: 'Courses', filename: 'courses-template.xlsx' },
}
const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

export async function downloadAcademicTemplate(req, res) {
  const type = req.params.type
  const template = templates[type]
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' })
  const file = await createExcelTemplate(template.headers, template.sheet)
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.attachment(template.filename)
  return res.send(file)
}

export async function importAcademicRows(req, res) {
  const type = req.params.type
  if (!templates[type]) throw badRequest('Choose classes or courses')
  if (!req.file || !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/octet-stream'].includes(req.file.mimetype)) throw badRequest('Choose an Excel .xlsx workbook')
  const rows = await parseExcelRows(req.file.buffer)
  if (!rows.length) throw badRequest('The workbook has no data rows')
  if (rows.length > 500) throw badRequest('Import up to 500 rows at a time')
  const required = templates[type].headers
  const missing = required.filter((header) => !Object.hasOwn(rows[0], header))
  if (missing.length) throw badRequest(`Template columns missing: ${missing.join(', ')}`)
  const summary = { created: 0, errors: [] }
  const departments = await Department.find({ isActive: true }).select('_id code').lean()
  const departmentByCode = new Map(departments.map((item) => [item.code.toUpperCase(), item]))
  const settings = await loadSystemSettings()
  const currentYear = settings.academic?.academicYear || `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`
  const allowedSemesters = settings.academic?.semesters?.length ? settings.academic.semesters : defaultCourseSemesters

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2
    try {
      const department = departmentByCode.get(row.departmentcode.toUpperCase())
      if (!department) throw new Error(`Department code "${row.departmentcode}" was not found`)
      if (type === 'classes') {
        if (!row.name || !row.classcode) throw new Error('Name and classCode are required')
        await Class.create({ name: row.name, classCode: row.classcode, department: department._id, level: row.level || null, description: row.description || '' })
      } else {
        const semester = row.semester
        if (!row.name || !row.coursecode || !row.classcode) throw new Error('Name, courseCode, and classCode are required')
        if (!allowedSemesters.includes(semester)) throw new Error(`Semester must be one of: ${allowedSemesters.join(', ')}`)
        const academicClass = await Class.findOne({ classCode: row.classcode.toUpperCase(), department: department._id, isActive: true }).select('_id').lean()
        if (!academicClass) throw new Error(`Active class code "${row.classcode}" was not found in ${department.code}`)
        await Course.create({ name: row.name, courseCode: row.coursecode, academicYear: currentYear, semester, department: department._id, class: academicClass._id, description: row.description || '' })
      }
      summary.created += 1
    } catch (error) {
      summary.errors.push({ row: rowNumber, message: error.code === 11000 ? 'Code already exists' : error.message })
    }
  }
  return res.status(201).json({ success: true, summary })
}
