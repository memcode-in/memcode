const DASHBOARD_APPEARANCE_STORAGE_KEY = 'memcode:dashboard:appearance:v1'
const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const SUPPORTED_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,/u
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const DEFAULT_DASHBOARD_COLOR = '#0c0f17'
export const DEFAULT_SIDEBAR_ICON_COLOR = '#8f9196'
export const DEFAULT_SIDEBAR_ACTIVE_COLOR = '#2f7dff'
export const DASHBOARD_BACKGROUND_ACCEPT = 'image/png,image/jpeg,image/webp'
export const DASHBOARD_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024

export const DASHBOARD_COLOR_PRESETS = [
  { name: 'Default', value: DEFAULT_DASHBOARD_COLOR },
  { name: 'Graphite', value: '#17191d' },
  { name: 'Slate', value: '#111720' },
  { name: 'Espresso', value: '#191410' },
  { name: 'Forest', value: '#101813' },
] as const

export interface DashboardAppearance {
  color: string
  image: string | null
  sidebarIconColor: string
  sidebarActiveColor: string
}

export function defaultDashboardAppearance(): DashboardAppearance {
  return {
    color: DEFAULT_DASHBOARD_COLOR,
    image: null,
    sidebarIconColor: DEFAULT_SIDEBAR_ICON_COLOR,
    sidebarActiveColor: DEFAULT_SIDEBAR_ACTIVE_COLOR,
  }
}

export function readDashboardAppearance(): DashboardAppearance {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_APPEARANCE_STORAGE_KEY)
    if (!raw) return defaultDashboardAppearance()
    const parsed = JSON.parse(raw) as Partial<DashboardAppearance>
    return normalizeDashboardAppearance(parsed)
  } catch {
    return defaultDashboardAppearance()
  }
}

export function saveDashboardAppearance(appearance: DashboardAppearance) {
  const normalized = normalizeDashboardAppearance(appearance)
  window.localStorage.setItem(DASHBOARD_APPEARANCE_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export async function readDashboardBackgroundFile(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }
  if (file.size > DASHBOARD_BACKGROUND_MAX_BYTES) {
    throw new Error('Keep the original image under 8 MB.')
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const scale = Math.min(1, 1920 / image.naturalWidth, 1200 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare that image.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/webp', 0.82)
    if (!SUPPORTED_IMAGE_DATA_URL.test(dataUrl)) throw new Error('That image could not be prepared.')
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function normalizeDashboardAppearance(value: Partial<DashboardAppearance>): DashboardAppearance {
  const color = typeof value.color === 'string' && HEX_COLOR.test(value.color)
    ? value.color.toLowerCase()
    : DEFAULT_DASHBOARD_COLOR
  const image = typeof value.image === 'string' && SUPPORTED_IMAGE_DATA_URL.test(value.image)
    ? value.image
    : null
  const sidebarIconColor = typeof value.sidebarIconColor === 'string' && HEX_COLOR.test(value.sidebarIconColor)
    ? value.sidebarIconColor.toLowerCase()
    : DEFAULT_SIDEBAR_ICON_COLOR
  const sidebarActiveColor = typeof value.sidebarActiveColor === 'string' && HEX_COLOR.test(value.sidebarActiveColor)
    ? value.sidebarActiveColor.toLowerCase()
    : DEFAULT_SIDEBAR_ACTIVE_COLOR
  return { color, image, sidebarIconColor, sidebarActiveColor }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That image could not be read.'))
    image.src = source
  })
}
