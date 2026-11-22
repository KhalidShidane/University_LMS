// Persistent email-provider health. Cached briefly in memory so hot paths do not hit the
// database on every call; changes made here update the cache immediately.
import EmailProviderState from '../../models/EmailProviderState.js'

const CACHE_MS = 15 * 1000
let cache = null

export function clearProviderStatusCache() { cache = null }

export async function getProviderStatus({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.state
  try {
    const state = await EmailProviderState.findOne({ key: 'global' }).lean() || { key: 'global', status: 'ok' }
    cache = { at: Date.now(), state }
    return state
  } catch {
    // If the status cannot be read, fall back to the last known value (or "ok").
    return cache?.state || { key: 'global', status: 'ok' }
  }
}

/** 'temporarily_blocked' only when the stored block was reported by the provider in use.
 * Switching providers never inherits a block. */
export function effectiveProviderStatus(state, provider) {
  return state?.status === 'temporarily_blocked' && Boolean(state.provider) && state.provider === provider ? 'temporarily_blocked' : 'ok'
}

export async function isProviderBlocked(provider) {
  return effectiveProviderStatus(await getProviderStatus(), provider) === 'temporarily_blocked'
}

export async function markProviderBlocked({ provider = '', errorCode, providerErrorCode = '', providerErrorIdentifier = '', httpStatus = null, message = '' }) {
  const now = new Date()
  const state = await EmailProviderState.findOneAndUpdate(
    { key: 'global' },
    // Pipeline update: keep the original start of the block when it is reported again.
    [{ $set: { key: 'global', status: 'temporarily_blocked', provider, since: { $cond: [{ $and: [{ $eq: ['$status', 'temporarily_blocked'] }, { $eq: ['$provider', provider] }] }, { $ifNull: ['$since', now] }, now] }, lastErrorCode: errorCode, providerErrorCode, providerErrorIdentifier, httpStatus, lastErrorMessage: String(message).slice(0, 300), lastCheckedAt: now } }],
    { upsert: true, new: true },
  ).lean()
  cache = { at: Date.now(), state }
  console.warn(`Email provider temporarily blocked (${providerErrorCode || errorCode}${providerErrorIdentifier ? `, ref ${providerErrorIdentifier}` : ''}); sending is paused until an administrator resumes it`)
  return state
}

export async function markProviderHealthy({ resumedBy = null } = {}) {
  const now = new Date()
  const state = await EmailProviderState.findOneAndUpdate(
    { key: 'global' },
    { $set: { status: 'ok', since: null, lastCheckedAt: now, resumedAt: now, resumedBy } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  cache = { at: Date.now(), state }
  return state
}
