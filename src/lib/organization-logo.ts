const ORGANIZATION_LOGO_KEY_PREFIX = 'memcode:company-brain:organization-logo:'

export const ORGANIZATION_LOGO_MAX_BYTES = 768 * 1024
export const ORGANIZATION_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp'

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function readOrganizationLogo(organizationId: string) {
  if (!organizationId) return null
  try {
    const value = window.localStorage.getItem(`${ORGANIZATION_LOGO_KEY_PREFIX}${organizationId}`)
    return value && isSupportedLogoDataUrl(value) ? value : null
  } catch {
    return null
  }
}

export function saveOrganizationLogo(organizationId: string, logo: string | null) {
  if (!organizationId) throw new Error('Choose an organization before saving its logo.')
  const key = `${ORGANIZATION_LOGO_KEY_PREFIX}${organizationId}`
  if (logo === null) {
    window.localStorage.removeItem(key)
    return
  }
  if (!isSupportedLogoDataUrl(logo)) throw new Error('Choose a PNG, JPEG, or WebP image.')
  window.localStorage.setItem(key, logo)
}

export function readOrganizationLogoFile(file: File) {
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return Promise.reject(new Error('Choose a PNG, JPEG, or WebP image.'))
  }
  if (file.size > ORGANIZATION_LOGO_MAX_BYTES) {
    return Promise.reject(new Error('Keep the logo under 768 KB.'))
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string' && isSupportedLogoDataUrl(reader.result)) {
        resolve(reader.result)
        return
      }
      reject(new Error('That image could not be read.'))
    }
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function isSupportedLogoDataUrl(value: string) {
  return /^data:image\/(?:png|jpeg|webp);base64,/u.test(value)
}
