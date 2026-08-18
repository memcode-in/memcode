import { useCallback, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  DASHBOARD_BACKGROUND_ACCEPT,
  DASHBOARD_COLOR_PRESETS,
  defaultDashboardAppearance,
  readDashboardBackgroundFile,
  saveDashboardAppearance,
  type DashboardAppearance,
} from '../lib/dashboard-appearance'
import { userFacingErrorMessage } from '../lib/user-facing-errors'
import AppModal from './ui/AppModal'

export type MemCodeNavigationSection = 'overview' | 'company' | 'inbox' | 'mcp' | 'usage' | 'account'

interface MemCodeSidebarProps {
  activeSection: string
  contextLabel?: string
  companyBrainEnabled?: boolean
  canViewUsage?: boolean
  showInbox?: boolean
  inboxUnreadCount?: number
  inboxUnreadCountCapped?: boolean
  showOnboarding?: boolean
  appearance: DashboardAppearance
  onAppearanceChange: (appearance: DashboardAppearance) => void
  onOpenOnboarding?: () => void
  onSectionChange: (section: MemCodeNavigationSection) => void
}

const navigationItems: readonly {
  id: MemCodeNavigationSection
  label: string
}[] = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'company', label: 'Company Brain' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'mcp', label: 'MCP' },
  { id: 'usage', label: 'Usage' },
  { id: 'account', label: 'Account' },
]

function SidebarIcon({ section }: { section: MemCodeNavigationSection }) {
  if (section === 'overview') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg>
  }
  if (section === 'company') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5a3 3 0 0 0-5 2v3a3 3 0 0 0 1 5.8V17a3 3 0 0 0 4 2.8M15 5a3 3 0 0 1 5 2v3a3 3 0 0 1-1 5.8V17a3 3 0 0 1-4 2.8M9 5v15M15 5v15M9 9h6M9 15h6"/></svg>
  }
  if (section === 'usage') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V12M12 19V5M19 19v-9M3 19h18"/></svg>
  }
  if (section === 'inbox') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM5 8l7 5 7-5"/></svg>
  }
  if (section === 'mcp') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V4M16 7V4M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7ZM12 16v4M8.5 20h7"/></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20c.7-3.8 2.9-5.8 6.5-5.8s5.8 2 6.5 5.8"/></svg>
}

function PencilIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM13.8 7.6l3 3M4 20h5" /></svg>
}

function OnboardingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14v16H5zM8 9l1.5 1.5L12 8M14 9h2M8 15l1.5 1.5L12 14M14 15h2" />
    </svg>
  )
}

export default function MemCodeSidebar({
  activeSection,
  contextLabel = 'MemCode',
  companyBrainEnabled = false,
  canViewUsage = false,
  showInbox = false,
  inboxUnreadCount = 0,
  inboxUnreadCountCapped = false,
  showOnboarding = false,
  appearance,
  onAppearanceChange,
  onOpenOnboarding,
  onSectionChange,
}: MemCodeSidebarProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [readingImage, setReadingImage] = useState(false)
  const [appearanceError, setAppearanceError] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const applyAppearance = useCallback((nextAppearance: DashboardAppearance) => {
    try {
      const savedAppearance = saveDashboardAppearance(nextAppearance)
      onAppearanceChange(savedAppearance)
      setAppearanceError(null)
    } catch {
      setAppearanceError('This browser could not save that background. Try a smaller image.')
    }
  }, [onAppearanceChange])

  const chooseBackgroundImage = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setReadingImage(true)
    setAppearanceError(null)
    try {
      const image = await readDashboardBackgroundFile(file)
      applyAppearance({ ...appearance, image })
    } catch (error) {
      setAppearanceError(userFacingErrorMessage(error, 'That image could not be used.'))
    } finally {
      input.value = ''
      setReadingImage(false)
    }
  }, [appearance, applyAppearance])

  const changeEditorOpen = useCallback((open: boolean) => {
    if (!open && readingImage) return
    setEditorOpen(open)
    if (!open) setAppearanceError(null)
  }, [readingImage])

  const previewStyle = {
    '--appearance-preview-color': appearance.color,
    '--appearance-preview-image': appearance.image ? `url("${appearance.image}")` : 'none',
    '--appearance-preview-icon': appearance.sidebarIconColor,
    '--appearance-preview-active': appearance.sidebarActiveColor,
  } as CSSProperties

  return (
    <>
      <aside className="memcode-sidebar">
        <a className="memcode-sidebar__brand" href="/" aria-label="MemCode home">
          <img src="/logo.jpeg" alt="" />
        </a>
        <span className="memcode-sidebar__wordmark" aria-hidden="true">{contextLabel}</span>

        <nav className="memcode-sidebar__navigation" aria-label="MemCode dashboard navigation">
          {navigationItems.filter((item) => (
            (companyBrainEnabled || (item.id !== 'company' && item.id !== 'inbox' && item.id !== 'mcp' && item.id !== 'usage'))
            && (item.id !== 'usage' || canViewUsage)
            && (item.id !== 'inbox' || showInbox)
          )).map((item) => {
            const active = activeSection === item.id
            const inboxLabel = item.id === 'inbox' && inboxUnreadCount > 0
              ? `Inbox, ${inboxUnreadCountCapped || inboxUnreadCount > 99 ? '99+' : inboxUnreadCount} unread`
              : item.label
            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'is-active' : ''}
                aria-current={active ? 'page' : undefined}
                aria-label={inboxLabel}
                title={item.label}
                onClick={() => onSectionChange(item.id)}
              >
                <span className="memcode-sidebar__icon"><SidebarIcon section={item.id} /></span>
                {item.id === 'inbox' && inboxUnreadCount > 0 ? (
                  <span className="memcode-sidebar__badge" aria-hidden="true">
                    {inboxUnreadCountCapped || inboxUnreadCount > 99 ? '99+' : inboxUnreadCount}
                  </span>
                ) : null}
                <span className="memcode-sidebar__tooltip" aria-hidden="true">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {showOnboarding && onOpenOnboarding ? (
          <button
            type="button"
            className="memcode-sidebar__onboarding"
            aria-label="Continue onboarding"
            title="Onboarding"
            onClick={onOpenOnboarding}
          >
            <span className="memcode-sidebar__icon"><OnboardingIcon /></span>
            <span className="memcode-sidebar__tooltip" aria-hidden="true">Onboarding</span>
          </button>
        ) : null}

        <button
          type="button"
          className="memcode-sidebar__appearance"
          aria-label="Customize dashboard background"
          aria-expanded={editorOpen}
          title="Customize background"
          onClick={() => setEditorOpen(true)}
        >
          <span className="memcode-sidebar__icon"><PencilIcon /></span>
          <span className="memcode-sidebar__tooltip" aria-hidden="true">Background</span>
        </button>
      </aside>

      <AppModal
        open={editorOpen}
        onOpenChange={changeEditorOpen}
        title="Make the dashboard yours"
        description="Choose the background and keep the sidebar readable on top of it."
        size="compact"
        busy={readingImage}
        dismissible={!readingImage}
        footer={(
          <>
            <button
              type="button"
              className="app-modal__action"
              disabled={readingImage}
              onClick={() => applyAppearance(defaultDashboardAppearance())}
            >Reset default</button>
            <button
              type="button"
              className="app-modal__action app-modal__action--primary"
              disabled={readingImage}
              onClick={() => changeEditorOpen(false)}
            >Done</button>
          </>
        )}
      >
        <div className="dashboard-appearance-editor">
          <div className="dashboard-appearance-editor__preview" style={previewStyle} aria-label="Dashboard background preview">
            <span aria-hidden="true"><i /><i className="is-active" /><i /></span>
            <div aria-hidden="true"><i /><i /><i /></div>
          </div>

          <fieldset>
            <legend>Background color</legend>
            <div className="dashboard-appearance-editor__colors">
              {DASHBOARD_COLOR_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.value}
                  aria-label={`${preset.name} background`}
                  aria-pressed={!appearance.image && appearance.color === preset.value}
                  style={{ '--appearance-color': preset.value } as CSSProperties}
                  onClick={() => applyAppearance({ ...appearance, color: preset.value, image: null })}
                ><span>{preset.name}</span></button>
              ))}
              <label>
                <input
                  type="color"
                  value={appearance.color}
                  aria-label="Custom background color"
                  onChange={(event) => applyAppearance({ ...appearance, color: event.target.value, image: null })}
                />
                <span>Custom</span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Sidebar icons</legend>
            <div className="dashboard-appearance-editor__sidebar-colors">
              <label>
                <span>Inactive</span>
                <input
                  type="color"
                  value={appearance.sidebarIconColor}
                  aria-label="Inactive sidebar icon color"
                  onInput={(event) => applyAppearance({ ...appearance, sidebarIconColor: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Active</span>
                <input
                  type="color"
                  value={appearance.sidebarActiveColor}
                  aria-label="Active sidebar icon color"
                  onInput={(event) => applyAppearance({ ...appearance, sidebarActiveColor: event.currentTarget.value })}
                />
              </label>
            </div>
          </fieldset>

          <section className="dashboard-appearance-editor__image" aria-labelledby="dashboard-background-image-title">
            <div>
              <strong id="dashboard-background-image-title">Your image</strong>
              <small>PNG, JPEG or WebP · up to 8 MB</small>
            </div>
            <div>
              <input
                ref={imageInputRef}
                type="file"
                accept={DASHBOARD_BACKGROUND_ACCEPT}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void chooseBackgroundImage(event)}
              />
              <button
                type="button"
                disabled={readingImage}
                onClick={() => imageInputRef.current?.click()}
              >{readingImage ? 'Preparing…' : appearance.image ? 'Replace image' : 'Upload image'}</button>
              {appearance.image ? (
                <button
                  type="button"
                  disabled={readingImage}
                  onClick={() => applyAppearance({ ...appearance, image: null })}
                >Remove</button>
              ) : null}
            </div>
          </section>

          {appearanceError ? <p className="dashboard-appearance-editor__error" role="alert">{appearanceError}</p> : null}
        </div>
      </AppModal>
    </>
  )
}
