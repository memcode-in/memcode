const rawApiUrl = import.meta.env.VITE_MEMORY_API_URL || 'https://memory.memcode.in'
// Company Brain owns sessions, billing, and dashboard data. If no dedicated
// origin is configured, fail closed to the current origin (where /api may be
// reverse-proxied to Brain); never send Brain credentials to the memory API.
const rawBrainApiUrl = import.meta.env.VITE_MEMCODE_BRAIN_API_URL || ''

export const API_URL = rawApiUrl.replace(/\/+$/, '')
export const BRAIN_API_URL = rawBrainApiUrl.replace(/\/+$/, '')

export function isAuthenticationRequired(status: number) {
  return status === 401
}
