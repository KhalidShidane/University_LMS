import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSettings } from './systemAdmin.controller.js'

const settings = {
  general: { institutionName: 'University', logo: '', contactEmail: 'admin@example.edu', phone: '', address: '', timezone: 'Africa/Nairobi', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  academic: { academicYear: '2026-27', semester: 'Semester 1', passingMarks: 50, gradingScale: [{ label: 'F', min: 0, max: 49.99 }, { label: 'A', min: 50, max: 100 }] },
  uploads: { maxFileSizeMB: 10, assignmentTypes: ['pdf', 'doc', 'docx', 'ppt', 'pptx'], learningMaterialTypes: ['pdf', 'docx'], profileImageTypes: ['jpg', 'png'] },
}

test('system settings validation accepts supported values and excludes secrets', () => {
  const record = validateSettings({ ...settings, jwtSecret: 'should never persist' })
  assert.equal(record.key, 'global')
  assert.equal(Object.hasOwn(record, 'jwtSecret'), false)
})

test('system settings validation rejects invalid timezone, grading overlap, and upload types', () => {
  assert.throws(() => validateSettings({ ...settings, general: { ...settings.general, timezone: 'Mars/Nope' } }), /Timezone is invalid/)
  assert.throws(() => validateSettings({ ...settings, academic: { ...settings.academic, gradingScale: [{ label: 'A', min: 0, max: 80 }, { label: 'B', min: 70, max: 100 }] } }), /non-overlapping/)
  assert.throws(() => validateSettings({ ...settings, uploads: { ...settings.uploads, profileImageTypes: ['svg'] } }), /unsupported file types/)
})

test('assignment upload settings accept PDF, Word, and PowerPoint formats', () => {
  const record = validateSettings(settings)
  assert.deepEqual(record.uploads.assignmentTypes, ['pdf', 'doc', 'docx', 'ppt', 'pptx'])
})
