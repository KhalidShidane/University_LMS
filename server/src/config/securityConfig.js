export function allowedClientOrigins({ nodeEnv = process.env.NODE_ENV, clientUrl = process.env.CLIENT_URL, clientOrigin = process.env.CLIENT_ORIGIN } = {}) {
  const configured = [clientUrl, clientOrigin].filter(Boolean).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  if (nodeEnv !== 'production') configured.push('http://localhost:5173')
  return [...new Set(configured)]
}

export function isAllowedClientOrigin(origin, options = {}) {
  if (!origin || origin === 'null') return false
  const { nodeEnv = process.env.NODE_ENV } = options
  const allowed = allowedClientOrigins(options)
  if (allowed.includes(origin)) return true
  if (nodeEnv === 'production') return false
  try {
    const parsed = new URL(origin)
    return parsed.origin === origin && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  } catch {
    return false
  }
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const problems = []
  if (!env.MONGODB_URI || !/^mongodb(?:\+srv)?:\/\//i.test(env.MONGODB_URI)) problems.push('MONGODB_URI must be a MongoDB connection URI')
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /replace_with|change_me|your[_-]?secret/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET must be a unique secret of at least 32 characters')
  if (!env.CLIENT_URL) problems.push('CLIENT_URL must list the production frontend origin')
  const origins = [env.CLIENT_URL, env.CLIENT_ORIGIN].filter(Boolean).flatMap((value) => value.split(',')).map((value) => value.trim())
  for (const origin of origins) {
    try {
      const parsed = new URL(origin)
      if (parsed.protocol !== 'https:' || parsed.origin !== origin) problems.push('Production client origins must be HTTPS origins without paths')
    } catch { problems.push('CLIENT_URL and CLIENT_ORIGIN must contain valid HTTPS origins') }
  }
  if (env.PORT && (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535)) problems.push('PORT must be a valid TCP port')
  if (env.JWT_EXPIRES_IN) {
    const match = env.JWT_EXPIRES_IN.match(/^(\d+)(s|m|h|d)$/)
    const seconds = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 })[match[2]] : 0
    if (!seconds || seconds > 7 * 86400) problems.push('JWT_EXPIRES_IN must be a duration of at most 7 days')
  }
  if (problems.length) throw new Error(`Production configuration is invalid: ${[...new Set(problems)].join('; ')}`)
}
