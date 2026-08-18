import { useEffect } from 'react'

const SITE_ORIGIN = 'https://memcode.in'
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo.jpeg`
const DEFAULT_DESCRIPTION =
  'MemCode is a terminal-first AI coding agent powered by long-term project memory, model routing, CLI skills, and remote approval workflows.'

type SeoConfig = {
  title: string
  description?: string
  path?: string
  type?: 'website' | 'article'
  image?: string
  noindex?: boolean
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

function absoluteUrl(path = '/') {
  if (path.startsWith('http')) return path
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function setMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }

  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value))
}

function setLink(rel: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!element) {
    element = document.createElement('link')
    element.rel = rel
    document.head.appendChild(element)
  }
  element.href = href
}

function setJsonLd(jsonLd?: SeoConfig['jsonLd']) {
  document.head.querySelector('script[data-seo-jsonld="true"]')?.remove()
  if (!jsonLd) return

  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.dataset.seoJsonld = 'true'
  script.textContent = JSON.stringify(jsonLd)
  document.head.appendChild(script)
}

export function useSeo(config: SeoConfig) {
  useEffect(() => {
    const description = config.description ?? DEFAULT_DESCRIPTION
    const url = absoluteUrl(config.path)
    const image = absoluteUrl(config.image ?? DEFAULT_IMAGE)

    document.title = config.title
    setLink('canonical', url)
    setMeta('meta[name="description"]', { name: 'description', content: description })
    setMeta('meta[name="robots"]', {
      name: 'robots',
      content: config.noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large',
    })
    setMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'MemCode' })
    setMeta('meta[property="og:title"]', { property: 'og:title', content: config.title })
    setMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    setMeta('meta[property="og:type"]', { property: 'og:type', content: config.type ?? 'website' })
    setMeta('meta[property="og:url"]', { property: 'og:url', content: url })
    setMeta('meta[property="og:image"]', { property: 'og:image', content: image })
    setMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
    setMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: config.title })
    setMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })
    setMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: image })
    setJsonLd(config.jsonLd)
  }, [config])
}

export { DEFAULT_DESCRIPTION, SITE_ORIGIN, absoluteUrl }
