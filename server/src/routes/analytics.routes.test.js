import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../app.js'

test('analytics and report export endpoints require an authenticated session', async () => {
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api`
    const endpoints = [
      '/admin/analytics/overview', '/admin/analytics/students', '/admin/analytics/teachers',
      '/admin/analytics/faculties', '/admin/analytics/departments', '/admin/analytics/classes',
      '/admin/analytics/assignments', '/admin/analytics/quizzes',
      '/admin/analytics/performance', '/teacher/analytics/overview',
      '/teacher/analytics/classes/000000000000000000000000',
      '/teacher/analytics/students/000000000000000000000000', '/student/analytics/performance',
      '/reports/export/pdf', '/reports/export/excel', '/reports/export/csv',
    ]
    for (const endpoint of endpoints) {
      const response = await fetch(`${base}${endpoint}`)
      assert.equal(response.status, 401, endpoint)
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
