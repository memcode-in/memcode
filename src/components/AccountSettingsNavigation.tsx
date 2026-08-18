import { createPortal, flushSync } from 'react-dom'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import SlackMark from './SlackMark'

export type AccountSettingsIconName =
  | 'general'
  | 'people'
  | 'usage'
  | 'proactivity'
  | 'billing'
  | 'profile'
  | 'slack'
  | 'invitation'
  | 'invite'
  | 'members'
  | 'access'
  | 'participation'
  | 'channels'
  | 'limits'
  | 'overview'
  | 'plan'
  | 'refunds'

export interface AccountSectionOption<SectionId extends string = string> {
  id: SectionId
  label: string
  description: string
  icon: AccountSettingsIconName
}

export interface AccountDetailOption<DetailId extends string = string> {
  id: DetailId
  label: string
  icon: AccountSettingsIconName
}

interface AccountSectionDeckProps<SectionId extends string> {
  sections: ReadonlyArray<AccountSectionOption<SectionId>>
  activeSection: SectionId | null
  onSectionChange: (section: SectionId | null) => void
  panelId?: string
}

interface AccountDetailNavigationProps<DetailId extends string> {
  items: ReadonlyArray<AccountDetailOption<DetailId>>
  activeItem: DetailId | null
  onItemChange: (item: DetailId | null) => void
  label: string
  panelId?: string
  children?: ReactNode
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

function withAccountTransition(update: () => void) {
  const documentWithTransition = document as ViewTransitionDocument
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion && documentWithTransition.startViewTransition) {
    documentWithTransition.startViewTransition(() => flushSync(update))
    return
  }
  update()
}

function AccountNavigationIcon({ name }: { name: AccountSettingsIconName }) {
  if (name === 'slack') return <SlackMark size={17} />

  const paths: Record<Exclude<AccountSettingsIconName, 'slack'>, ReactNode> = {
    general: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    people: <><path d="M16 20a4 4 0 0 0-8 0" /><circle cx="12" cy="10" r="3" /><path d="M19 8a2.5 2.5 0 0 1 0 5M5 8a2.5 2.5 0 0 0 0 5" /></>,
    usage: <><path d="M5 19V12M12 19V5M19 19v-9M3 19h18" /></>,
    proactivity: <><path d="M13 2 5 14h6l-1 8 8-12h-6z" /></>,
    billing: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></>,
    profile: <><circle cx="12" cy="8" r="3" /><path d="M6 20a6 6 0 0 1 12 0" /></>,
    invitation: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
    invite: <><circle cx="9" cy="9" r="3" /><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" /></>,
    members: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2" /><path d="M3 20a6 6 0 0 1 12 0M15 16a4 4 0 0 1 6 4" /></>,
    access: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" /></>,
    participation: <><path d="M4 13a8 8 0 1 1 3 6l-4 1 1-4a8 8 0 0 1 0-3Z" /><path d="M9 12h6" /></>,
    channels: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
    limits: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    overview: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    plan: <><path d="M4 19V9l8-5 8 5v10" /><path d="M8 19v-6h8v6" /></>,
    refunds: <><path d="M4 8h11a5 5 0 1 1 0 10H8" /><path d="m8 4-4 4 4 4" /></>,
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function AccountSectionDeck<SectionId extends string>({
  sections,
  activeSection,
  onSectionChange,
  panelId,
}: AccountSectionDeckProps<SectionId>) {
  const active = sections.find((section) => section.id === activeSection) || null
  const compact = active ? sections.filter((section) => section.id !== active.id) : []

  const selectSection = (section: AccountSectionOption<SectionId>, focus = false) => {
    const nextSection = section.id === activeSection ? null : section.id
    withAccountTransition(() => onSectionChange(nextSection))
    if (focus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`account-section-${nextSection || section.id}`)?.focus()
      })
    }
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    section: AccountSectionOption<SectionId>,
  ) => {
    const index = sections.findIndex((candidate) => candidate.id === section.id)
    let nextIndex = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % sections.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + sections.length) % sections.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = sections.length - 1
    else return
    event.preventDefault()
    selectSection(sections[nextIndex], true)
  }

  const renderSection = (section: AccountSectionOption<SectionId>, selected: boolean, index: number) => (
    <button
      key={section.id}
      id={`account-section-${section.id}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={selected ? panelId : undefined}
      tabIndex={selected || (!active && index === 0) ? 0 : -1}
      className={`account-section-deck__card ${selected ? 'is-active' : ''}`}
      style={{
        '--account-section-index': index,
        viewTransitionName: `account-section-${section.id}`,
      } as CSSProperties}
      onClick={() => selectSection(section)}
      onKeyDown={(event) => handleKeyDown(event, section)}
    >
      <span className="account-section-deck__card-top">
        <span className="account-section-deck__icon"><AccountNavigationIcon name={section.icon} /></span>
        <span className="account-section-deck__ellipsis" aria-hidden="true"><i /><i /><i /></span>
      </span>
      <span className="account-section-deck__copy">
        <strong>{section.label}</strong>
        <small>{section.description}</small>
      </span>
    </button>
  )

  return (
    <nav className={`account-section-deck ${active ? 'has-selection' : 'is-collapsed'}`} role="tablist" aria-label="Account sections">
      {active ? (
        <>
          <div className="account-section-deck__primary">
            {renderSection(active, true, sections.findIndex((section) => section.id === active.id))}
          </div>
          <div className="account-section-deck__rail">
            {compact.map((section) => renderSection(section, false, sections.findIndex((candidate) => candidate.id === section.id)))}
          </div>
        </>
      ) : (
        <div className="account-section-deck__grid">
          {sections.map((section, index) => renderSection(section, false, index))}
        </div>
      )}
    </nav>
  )
}

export function AccountDetailNavigation<DetailId extends string>({
  items,
  activeItem,
  onItemChange,
  label,
  panelId,
  children,
}: AccountDetailNavigationProps<DetailId>) {
  const selectItem = (item: AccountDetailOption<DetailId>, focus = false) => {
    const nextItem = item.id === activeItem ? null : item.id
    onItemChange(nextItem)
    if (focus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`account-detail-${item.id}`)?.focus()
      })
    }
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: AccountDetailOption<DetailId>,
  ) => {
    const index = items.findIndex((candidate) => candidate.id === item.id)
    let nextIndex = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else return
    event.preventDefault()
    selectItem(items[nextIndex], true)
  }

  const dock = (
    <aside className={`account-detail-dock ${activeItem && children ? 'has-active-item' : ''}`} aria-label={label}>
      <div className="account-detail-dock__theme dashboard-shell--brain">
        {activeItem && children ? (
          <div className="company-brain-settings__config">{children}</div>
        ) : null}
        <nav className="account-detail-tabs" role="tablist" aria-label={`${label} actions`}>
          {items.map((item) => {
            const selected = item.id === activeItem
            return (
              <button
                key={item.id}
                id={`account-detail-${item.id}`}
                type="button"
                role="tab"
                aria-label={item.label}
                aria-selected={selected}
                aria-controls={selected ? panelId : undefined}
                tabIndex={selected || (!activeItem && item === items[0]) ? 0 : -1}
                className={selected ? 'is-active' : ''}
                onClick={() => selectItem(item)}
                onKeyDown={(event) => handleKeyDown(event, item)}
              >
                <span aria-hidden="true"><AccountNavigationIcon name={item.icon} /></span>
                <strong>{item.label}</strong>
              </button>
            )
          })}
        </nav>
      </div>
    </aside>
  )

  return typeof document === 'undefined' ? dock : createPortal(dock, document.body)
}
