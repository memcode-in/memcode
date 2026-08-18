const ORGANIZATION_HEADER = 'X-Memcode-Organization-Id'

let activeOrganizationId: string | null = null

export function setActiveBrainOrganizationId(organizationId: string | null | undefined) {
  const normalized = organizationId?.trim()
  activeOrganizationId = normalized || null
}

export function getActiveBrainOrganizationId() {
  return activeOrganizationId
}

export function organizationScopedHeaders(initial?: HeadersInit, expectedOrganizationId = activeOrganizationId) {
  const headers = new Headers(initial)
  if (expectedOrganizationId) headers.set(ORGANIZATION_HEADER, expectedOrganizationId)
  return headers
}
