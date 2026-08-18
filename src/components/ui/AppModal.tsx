import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './app-modal.css'

type AppModalSize = 'compact' | 'standard' | 'wide'

interface AppModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: AppModalSize
  dismissible?: boolean
  busy?: boolean
  closeLabel?: string
  className?: string
}

const FOCUSABLE_SELECTOR = [
  '[data-modal-autofocus]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let bodyLockCount = 0
let bodyOverflowBeforeModal = ''

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeModal = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  bodyLockCount += 1

  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1)
    if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeModal
  }
}

export default function AppModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'standard',
  dismissible = true,
  busy = false,
  closeLabel = 'Close dialog',
  className,
}: AppModalProps) {
  const [present, setPresent] = useState(open)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (open) {
      setPresent(true)
      setClosing(false)
      return undefined
    }
    if (!present) return undefined

    setClosing(true)
    const timer = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, present])

  useEffect(() => {
    if (!open) return undefined

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const unlockBodyScroll = lockBodyScroll()
    const focusFrame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-modal-autofocus]')
        ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      target?.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusFrame)
      unlockBodyScroll()
      const previousFocus = previousFocusRef.current
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !dismissible) return undefined
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [dismissible, onOpenChange, open])

  if (!present) return null

  const requestClose = () => {
    if (dismissible) onOpenChange(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
      .filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className={`app-modal__backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div className={`app-modal__frame app-modal__frame--${size}${closing ? ' is-closing' : ''}`}>
        <span className="app-modal__layer app-modal__layer--back" aria-hidden="true" />
        <span className="app-modal__layer app-modal__layer--middle" aria-hidden="true" />
        <div
          ref={panelRef}
          className={`app-modal__panel${className ? ` ${className}` : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          aria-busy={busy || undefined}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <header className="app-modal__header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
            <button
              type="button"
              className="app-modal__close"
              aria-label={closeLabel}
              disabled={!dismissible}
              onClick={requestClose}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </header>

          <div className="app-modal__body">{children}</div>
          {footer ? <footer className="app-modal__footer">{footer}</footer> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
