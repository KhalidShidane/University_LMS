import test from 'node:test'
import assert from 'node:assert/strict'
import { createCsvExport, createPdfExport, createStudentPerformancePdf, createXlsxExport } from './analytics.controller.js'

test('CSV exports quote values and protect spreadsheet formulas', () => {
  const output = createCsvExport([['Name', 'Score'], ['=1+1', '8,5'], ['A "student"', 9]])
  assert.ok(output.startsWith('\uFEFF'))
  assert.match(output, /"'=1\+1"/)
  assert.match(output, /"8,5"/)
  assert.match(output, /"A ""student"""/)
})

test('XLSX export is a ZIP workbook with escaped cell data', () => {
  const output = createXlsxExport([['Student', 'Result'], ['A & B', '<pass>']])
  assert.equal(output.readUInt32LE(0), 0x04034b50)
  assert.ok(output.includes(Buffer.from('xl/workbook.xml')))
  assert.ok(output.includes(Buffer.from('A &amp; B')))
  assert.ok(output.includes(Buffer.from('&lt;pass&gt;')))
  assert.equal(output.readUInt32LE(output.length - 22), 0x06054b50)
})

test('PDF export creates a readable PDF and adds pages for long reports', () => {
  const rows = Array.from({ length: 110 }, (_, index) => [`Student ${index}`, '82%'])
  const output = createPdfExport(rows, 'Academic report')
  const content = output.toString('latin1')
  assert.ok(content.startsWith('%PDF-1.4'))
  assert.match(content, /\/Count 3/)
  assert.match(content, /Student 109/)
  assert.ok(content.endsWith('%%EOF'))
})

test('student performance PDF includes a summary chart and assessment details', () => {
  const output = createStudentPerformancePdf({
    student: { fullName: 'Amina Ahmed', studentId: 'ST-204', class: { name: 'Class A', department: { name: 'Computing', faculty: { name: 'Science' } } } },
    summary: { assignmentAverage: 82, quizAverage: 76, overallPerformance: 79, submittedAssignments: 3, missingAssignments: 1, pendingAssignments: 1, completedQuizzes: 2 },
    assignments: [{ title: 'Algebra assignment', status: 'graded', marksAwarded: 8, totalMarks: 10 }],
    quizzes: [{ title: 'Unit quiz', status: 'graded', score: 9, maxScore: 10 }],
  })
  const content = output.toString('latin1')
  assert.ok(content.startsWith('%PDF-1.4'))
  assert.match(content, /My Academic Performance/)
  assert.match(content, /ST-204/)
  assert.match(content, /PERFORMANCE SNAPSHOT/)
  assert.match(content, /ASSIGNMENT PROGRESS/)
  assert.match(content, /Algebra assignment/)
  assert.match(content, /Unit quiz/)
  assert.match(content, /re f/)
  assert.ok(content.endsWith('%%EOF'))
})
