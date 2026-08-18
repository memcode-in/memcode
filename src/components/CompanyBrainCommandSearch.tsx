import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GooeyInput } from './ui/gooey-input'

export type CompanyBrainCommandSection = 'overview' | 'company' | 'inbox' | 'connectors' | 'settings' | 'code' | 'mcp' | 'usage' | 'account' | 'pricing'

interface CommandDestination {
  id: CompanyBrainCommandSection
  label: string
  description: string
  keywords: string
}

const COMMAND_DESTINATIONS: readonly CommandDestination[] = [
  { id: 'overview', label: 'Dashboard', description: 'Your main MemCode overview', keywords: 'home main dashboard' },
  { id: 'company', label: 'Company overview', description: 'People, activity and shared knowledge', keywords: 'team company memory' },
  { id: 'inbox', label: 'Inbox', description: 'Mail received by Company Brain', keywords: 'email mailbox messages unread' },
  { id: 'connectors', label: 'Connectors', description: 'Connected tools and integrations', keywords: 'apps integrations slack notion linear' },
  { id: 'settings', label: 'Brain settings', description: 'Model, provider keys and research tools', keywords: 'model firecrawl tools api keys runtime' },
  { id: 'code', label: 'Code Mode', description: 'Coding agents, managed execution and GitHub policy', keywords: 'codex claude cursor managed workspace repository pull request' },
  { id: 'mcp', label: 'MCP', description: 'Use Company Brain from coding clients', keywords: 'codex claude cursor custom setup token' },
  { id: 'usage', label: 'Usage', description: 'Plan capacity and operations', keywords: 'limits allowance quota capacity' },
  { id: 'account', label: 'Account', description: 'People, access and settings', keywords: 'members invitations billing proactivity settings' },
  { id: 'pricing', label: 'Pricing', description: 'Plans and billing options', keywords: 'plan upgrade checkout' },
]

export default function CompanyBrainCommandSearch({
  activeSection,
  showInbox = false,
  onNavigate,
}: {
  activeSection: CompanyBrainCommandSection
  showInbox?: boolean
  onNavigate: (section: CompanyBrainCommandSection) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const available = COMMAND_DESTINATIONS.filter((destination) => destination.id !== 'inbox' || showInbox)
    if (!normalizedQuery) return available
    return available.filter((destination) => (
      `${destination.label} ${destination.description} ${destination.keywords}`
        .toLowerCase()
        .includes(normalizedQuery)
    ))
  }, [query, showInbox])

  const navigate = useCallback((section: CompanyBrainCommandSection) => {
    onNavigate(section)
    setQuery('')
    setOpen(false)
  }, [onNavigate])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  return (
    <div className="dashboard-command-search" ref={rootRef}>
      <GooeyInput
        open={open}
        value={query}
        placeholder="Search · ⌘K"
        collapsedWidth={140}
        expandedWidth={270}
        expandedOffset={44}
        gooeyBlur={4}
        ariaLabel="Open dashboard search, Command K"
        onOpenChange={setOpen}
        onValueChange={setQuery}
        onEscape={() => setQuery('')}
        onSubmit={() => {
          if (results[0]) navigate(results[0].id)
        }}
        classNames={{
          root: 'dashboard-command-search__gooey',
          trigger: 'dashboard-command-search__trigger',
          input: 'dashboard-command-search__input',
          bubbleSurface: 'dashboard-command-search__bubble',
        }}
      />

      {open ? (
        <div className="dashboard-command-search__results" role="listbox" aria-label="Dashboard destinations">
          {results.length ? results.map((destination) => (
            <button
              type="button"
              role="option"
              aria-selected={destination.id === activeSection}
              key={destination.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => navigate(destination.id)}
            >
              <span>{destination.label}</span>
              <small>{destination.description}</small>
            </button>
          )) : (
            <p>No matching section.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
