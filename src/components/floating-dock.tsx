import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

export type FloatingDockItem = {
  title: string
  icon: ReactNode
  href?: string
  onClick?: () => void
  active?: boolean
}

interface FloatingDockProps {
  items: FloatingDockItem[]
  desktopClassName?: string
  mobileClassName?: string
}

export function FloatingDock({
  items,
  desktopClassName = '',
  mobileClassName = '',
}: FloatingDockProps) {
  return (
    <>
      <FloatingDockDesktop items={items} className={desktopClassName} />
      <FloatingDockMobile items={items} className={mobileClassName} />
    </>
  )
}

function FloatingDockMobile({
  items,
  className,
}: {
  items: FloatingDockItem[]
  className: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`floating-dock__mobile ${className}`.trim()}>
      <div className={`floating-dock__mobile-items ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        {items.map((item, index) => (
          <DockItemControl
            key={item.title}
            item={item}
            className="floating-dock__control--mobile"
            style={{ '--floating-dock-order': index } as CSSProperties}
            tabIndex={open ? undefined : -1}
            onActivate={() => setOpen(false)}
          />
        ))}
      </div>
      <button
        type="button"
        className={`floating-dock__menu ${open ? 'is-open' : ''}`}
        aria-label="Toggle Company Brain navigation"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      </button>
    </div>
  )
}

function FloatingDockDesktop({
  items,
  className,
}: {
  items: FloatingDockItem[]
  className: string
}) {
  const itemRefs = useRef<Array<HTMLElement | null>>([])

  const updatePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    itemRefs.current.forEach((element) => {
      if (!element) return
      const bounds = element.getBoundingClientRect()
      const distance = Math.abs(event.clientX - (bounds.left + bounds.width / 2))
      const influence = Math.max(0, 1 - distance / 140)
      element.style.setProperty('--floating-dock-item-size', `${42 + influence * 26}px`)
      element.style.setProperty('--floating-dock-icon-size', `${18 + influence * 12}px`)
      element.style.setProperty('--floating-dock-lift', `${influence * -5}px`)
    })
  }

  const resetItems = () => {
    itemRefs.current.forEach((element) => {
      if (!element) return
      element.style.removeProperty('--floating-dock-item-size')
      element.style.removeProperty('--floating-dock-icon-size')
      element.style.removeProperty('--floating-dock-lift')
    })
  }

  return (
    <div
      className={`floating-dock__desktop ${className}`.trim()}
      onPointerMove={updatePointer}
      onPointerLeave={resetItems}
    >
      {items.map((item, index) => (
        <DockItemControl
          key={item.title}
          item={item}
          refSlot={itemRefs}
          refIndex={index}
        />
      ))}
    </div>
  )
}

function DockItemControl({
  item,
  className = '',
  style,
  tabIndex,
  onActivate,
  refSlot,
  refIndex,
}: {
  item: FloatingDockItem
  className?: string
  style?: CSSProperties
  tabIndex?: number
  onActivate?: () => void
  refSlot?: RefObject<Array<HTMLElement | null>>
  refIndex?: number
}) {
  const classes = `floating-dock__control ${item.active ? 'is-active' : ''} ${className}`.trim()
  const setControlRef = (element: HTMLElement | null) => {
    if (refSlot && refIndex !== undefined) refSlot.current[refIndex] = element
  }
  const content = (
    <>
      <span className="floating-dock__tooltip" aria-hidden="true">{item.title}</span>
      <span className="floating-dock__icon" aria-hidden="true">{item.icon}</span>
    </>
  )

  if (item.onClick) {
    return (
      <button
        ref={setControlRef}
        type="button"
        className={classes}
        style={style}
        tabIndex={tabIndex}
        aria-label={item.title}
        aria-current={item.active ? 'page' : undefined}
        onClick={() => {
          item.onClick?.()
          onActivate?.()
        }}
      >
        {content}
      </button>
    )
  }

  return (
    <a
      ref={setControlRef}
      href={item.href ?? '#'}
      className={classes}
      style={style}
      tabIndex={tabIndex}
      aria-label={item.title}
      aria-current={item.active ? 'page' : undefined}
      onClick={onActivate}
    >
      {content}
    </a>
  )
}
