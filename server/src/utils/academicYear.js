export function academicYearStart(value) {
  return Number(String(value || '').match(/^\d{4}/)?.[0] || 0)
}

export function resolveCurrentAcademicYear(configuredYear, courseYears, now = new Date()) {
  if (configuredYear && academicYearStart(configuredYear)) return configuredYear

  const calendarYear = now.getFullYear()
  const applicableYears = courseYears
    .filter((year) => academicYearStart(year) > 0 && academicYearStart(year) <= calendarYear)
    .sort((left, right) => academicYearStart(right) - academicYearStart(left))
  if (applicableYears.length) return applicableYears[0]

  return `${calendarYear}-${calendarYear + 1}`
}