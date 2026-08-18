import { getCalApi } from '@calcom/embed-react'
import { useEffect, type MouseEvent, type ReactNode } from 'react'
import {
  BOOKING_CAL_LINK,
  BOOKING_EMBED_CONFIG,
  BOOKING_NAMESPACE,
  BOOKING_URL,
} from '../../config/booking'

interface BookingLinkProps {
  children?: ReactNode
  className?: string
  /** Visual style. `bare` renders no button styling (for custom wrappers). */
  variant?: 'primary' | 'ghost' | 'dark' | 'nav' | 'bare'
  ariaLabel?: string
}

const variantClass: Record<NonNullable<BookingLinkProps['variant']>, string> = {
  primary: 'btn btn--primary',
  ghost: 'btn btn--ghost',
  dark: 'btn btn--dark',
  nav: 'nav-cta',
  bare: '',
}

let calSetupPromise: Promise<void> | undefined

function setupCalEmbed() {
  if (!calSetupPromise) {
    calSetupPromise = getCalApi({ namespace: BOOKING_NAMESPACE })
      .then((cal) => {
        cal('ui', {
          cssVarsPerTheme: {
            light: { 'cal-brand': '#000000' },
            dark: { 'cal-brand': '#ffffff' },
          },
          hideEventTypeDetails: false,
          layout: 'month_view',
        })
      })
      .catch((error) => {
        calSetupPromise = undefined
        throw error
      })
  }

  return calSetupPromise
}

function getReadyCalApi() {
  if (!window.Cal?.version) return null
  return window.Cal.ns?.[BOOKING_NAMESPACE] ?? null
}

/**
 * The single founder-booking action used across every marketing surface. Cal's
 * profile opens in a modal, while the href remains a no-JavaScript fallback.
 */
export default function BookingLink({
  children = 'Talk to us',
  className = '',
  variant = 'primary',
  ariaLabel,
}: BookingLinkProps) {
  useEffect(() => {
    void setupCalEmbed().catch(() => {
      // The regular Cal.com href remains available if the embed cannot load.
    })
  }, [])

  const openBookingModal = (event: MouseEvent<HTMLAnchorElement>) => {
    const cal = getReadyCalApi()
    if (!cal) return

    event.preventDefault()
    event.stopPropagation()

    try {
      cal('modal', {
        calLink: BOOKING_CAL_LINK,
        config: {
          layout: 'month_view',
          useSlotsViewOnSmallScreen: 'true',
        },
      })
    } catch {
      window.location.assign(BOOKING_URL)
    }
  }

  const base = variantClass[variant]
  return (
    <a
      className={`${base} ${className}`.trim()}
      href={BOOKING_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      data-cal-namespace={BOOKING_NAMESPACE}
      data-cal-link={BOOKING_CAL_LINK}
      data-cal-config={BOOKING_EMBED_CONFIG}
      onClick={openBookingModal}
    >
      {children}
    </a>
  )
}
