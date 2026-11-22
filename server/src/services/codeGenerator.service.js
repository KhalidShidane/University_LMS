// Generates short, unique, human-readable codes for academic records from their names.
// e.g. "Computer Science and IT" -> "CSIT", then "CSIT2", "CSIT3" ... if taken.
// Courses use a numbered style: "Database Systems" -> "DS101", "DS102" ...

const STOP_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'to', 'a', 'an', '&', 'iyo', 'ee', 'ka', 'ku'])

export function acronymFromName(name, maxLength = 6) {
  const words = String(name || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const meaningful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
  const source = meaningful.length ? meaningful : words
  if (!source.length) return 'GEN'
  let base
  if (source.length === 1) {
    base = source[0].slice(0, 4)
  } else {
    // Keep fully upper-case short words (e.g. "IT", "ICT") intact; otherwise take initials.
    base = source.map((word) => (/^[A-Z0-9]{2,4}$/.test(word) ? word : word[0])).join('')
  }
  return base.toUpperCase().slice(0, maxLength) || 'GEN'
}

/**
 * @param {import('mongoose').Model} Model
 * @param {string} field   document field holding the code
 * @param {string} name    record name used to derive the code
 * @param {{ maxLength?: number, numbered?: boolean }} options
 */
export async function generateUniqueCode(Model, field, name, { maxLength = 20, numbered = false } = {}) {
  const base = acronymFromName(name, Math.max(2, maxLength - 4))
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = numbered
      ? `${base}${101 + attempt}`
      : attempt === 0 ? base : `${base}${attempt + 1}`
    if (candidate.length > maxLength) break
    // Check against all records (active or not) because unique indexes cover both.
    if (!(await Model.exists({ [field]: candidate }))) return candidate
  }
  return `${base.slice(0, Math.max(2, maxLength - 7))}${Date.now().toString(36).slice(-6).toUpperCase()}`
}

export const isDuplicateKeyError = (error) => error?.code === 11000

/** Runs create(code) with a freshly generated code, retrying if a concurrent insert took it. */
export async function createWithGeneratedCode(Model, field, name, create, options) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = await generateUniqueCode(Model, field, name, options)
    try {
      return await create(code)
    } catch (error) {
      if (!isDuplicateKeyError(error) || !error.keyPattern?.[field]) throw error
      lastError = error
    }
  }
  throw lastError
}
