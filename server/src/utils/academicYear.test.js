import test from 'node:test'
import assert from 'node:assert/strict'
import { academicYearStart, resolveCurrentAcademicYear } from './academicYear.js'

test('current academic year wins over a later course year', () => {
  const courseYears = ['2028-2029', '2026-2027']
  const currentYear = resolveCurrentAcademicYear('2026-2027', courseYears, new Date(2026, 10, 17))
  assert.equal(currentYear, '2026-2027')
  assert.equal(academicYearStart('2028-2029') > academicYearStart(currentYear), true)
})

test('fallback ignores future course years when resolving the current year', () => {
  const courseYears = ['2028-2029', '2026-2027']
  assert.equal(resolveCurrentAcademicYear('', courseYears, new Date(2026, 10, 17)), '2026-2027')
})

test('a future-only course list does not become the current academic year', () => {
  assert.equal(resolveCurrentAcademicYear('', ['2028-2029'], new Date(2026, 10, 17)), '2026-2027')
})

test('academic year fallback uses the calendar year when no course years exist', () => {
  assert.equal(resolveCurrentAcademicYear('', [], new Date(2026, 10, 17)), '2026-2027')
})
