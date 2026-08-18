const configuredLandingOrigin = (import.meta.env.VITE_MEMCODE_LANDING_URL || 'https://memcode.in')
  .trim()
  .replace(/\/+$/, '')

export function getLoginUrl(returnUrl?: string) {
  const params = new URLSearchParams()
  if (returnUrl) params.set('returnUrl', returnUrl)

  const query = params.toString()
  const loginPath = `/login${query ? `?${query}` : ''}`
  return loginPath
}

export function getLandingUrl(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, `${configuredLandingOrigin}/`).toString()
}
