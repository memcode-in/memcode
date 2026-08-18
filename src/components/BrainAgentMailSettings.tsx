import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import type { BrainDashboard } from '../lib/brain-dashboard'
import {
  CompanyMailboxHttpError,
  createCompanyMailbox,
  fetchCompanyMailboxSlackChannels,
  fetchCompanyMailboxSummary,
  updateCompanyMailboxSlackDelivery,
  type CompanyMailboxSlackChannels,
  type CompanyMailboxSummary,
} from '../lib/brain-company-mailbox'
import { userFacingErrorMessage } from '../lib/user-facing-errors'
import CompanyMailboxSlackDelivery, {
  type CompanyMailboxSlackChannelsLoadState,
} from './CompanyMailboxSlackDelivery'
import './brain-runtime-settings.css'

interface BrainAgentMailSettingsProps {
  dashboard: BrainDashboard
  demoMode: boolean
  onAuthenticationRequired: () => void
}

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u
const DEMO_SUMMARY: CompanyMailboxSummary = {
  status: 'not_configured',
  address: null,
  addressPreview: 'memcode@agentmail.to',
  displayName: null,
  canManage: true,
  unreadCount: 0,
  unreadCountCapped: false,
  slackDelivery: {
    available: true,
    enabled: false,
    teamId: 'T-DEMO',
    channelId: null,
    channelName: null,
    lastError: null,
    updatedAt: null,
  },
  lastError: null,
  updatedAt: null,
}
const DEMO_SLACK_CHANNELS: CompanyMailboxSlackChannels = {
  status: 'ready',
  teamId: 'T-DEMO',
  channels: [
    { id: 'C-GENERAL', name: 'general', isMember: true },
    { id: 'C-COMPANY-BRAIN', name: 'company-brain', isMember: true },
  ],
}

function statusLabel(summary: CompanyMailboxSummary) {
  if (summary.status === 'ready') return 'Ready'
  if (summary.status === 'provisioning') return 'Preparing'
  if (summary.status === 'failed') return 'Needs attention'
  if (summary.status === 'unavailable') return 'Unavailable'
  return 'Not created'
}

function previewDomain(summary: CompanyMailboxSummary | null) {
  const preview = summary?.addressPreview
  const at = preview?.lastIndexOf('@') ?? -1
  return at >= 0 ? preview!.slice(at + 1) : 'agentmail.to'
}

export default function BrainAgentMailSettings({
  dashboard,
  demoMode,
  onAuthenticationRequired,
}: BrainAgentMailSettingsProps) {
  const [summary, setSummary] = useState<CompanyMailboxSummary | null>(demoMode ? DEMO_SUMMARY : null)
  const [localPart, setLocalPart] = useState('memcode')
  const [displayName, setDisplayName] = useState(`${dashboard.organization.name} Company Brain`)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(demoMode ? 'ready' : 'loading')
  const [creating, setCreating] = useState(false)
  const [slackChannels, setSlackChannels] = useState<CompanyMailboxSlackChannels | null>(demoMode ? DEMO_SLACK_CHANNELS : null)
  const [slackChannelsLoadState, setSlackChannelsLoadState] = useState<CompanyMailboxSlackChannelsLoadState>(demoMode ? 'ready' : 'idle')
  const [slackChannelsRetryAt, setSlackChannelsRetryAt] = useState<number | null>(null)
  const [slackDeliveryEnabled, setSlackDeliveryEnabled] = useState(false)
  const [slackDeliveryChannelId, setSlackDeliveryChannelId] = useState('')
  const [savingSlackDelivery, setSavingSlackDelivery] = useState(false)
  const [mailboxActionRetryAt, setMailboxActionRetryAt] = useState<number | null>(null)
  const [mailboxActionNow, setMailboxActionNow] = useState(() => Date.now())
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const requestKeyRef = useRef<string | null>(null)
  const slackDeliveryAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const slackDeliveryDraftInitializedRef = useRef(false)
  const slackChannelsRequestRef = useRef<AbortController | null>(null)
  const slackChannelsRetryAtRef = useRef<number | null>(null)
  const retryAtRef = useRef<number | null>(null)
  const currentOrganizationScopeRef = useRef({ organizationId: dashboard.organization.id })
  if (currentOrganizationScopeRef.current.organizationId !== dashboard.organization.id) {
    currentOrganizationScopeRef.current = { organizationId: dashboard.organization.id }
  }

  const initializeSlackDeliveryDraft = useCallback((next: CompanyMailboxSummary) => {
    if (slackDeliveryDraftInitializedRef.current) return
    slackDeliveryDraftInitializedRef.current = true
    setSlackDeliveryEnabled(next.slackDelivery.enabled)
    setSlackDeliveryChannelId(next.slackDelivery.channelId ?? '')
  }, [])

  const loadSlackChannels = useCallback(async () => {
    const requestOrganizationId = dashboard.organization.id
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return null
    if (demoMode) {
      if (currentOrganizationScopeRef.current !== requestScope) return null
      slackChannelsRetryAtRef.current = null
      setSlackChannelsRetryAt(null)
      setSlackChannels(DEMO_SLACK_CHANNELS)
      setSlackChannelsLoadState('ready')
      return DEMO_SLACK_CHANNELS
    }
    if (slackChannelsRetryAtRef.current !== null && Date.now() < slackChannelsRetryAtRef.current) {
      return null
    }
    slackChannelsRetryAtRef.current = null
    setSlackChannelsRetryAt(null)
    slackChannelsRequestRef.current?.abort()
    const controller = new AbortController()
    slackChannelsRequestRef.current = controller
    setSlackChannels(null)
    setSlackChannelsLoadState('loading')
    try {
      const next = await fetchCompanyMailboxSlackChannels(requestOrganizationId, controller.signal)
      if (
        controller.signal.aborted
        || slackChannelsRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      slackChannelsRetryAtRef.current = null
      setSlackChannelsRetryAt(null)
      setSlackChannels(next)
      setSlackChannelsLoadState('ready')
      return next
    } catch (error) {
      if (
        controller.signal.aborted
        || slackChannelsRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      if (error instanceof CompanyMailboxHttpError && error.status === 401) {
        onAuthenticationRequired()
        return null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        const retryAt = Date.now() + error.retryAfterMs
        slackChannelsRetryAtRef.current = retryAt
        setSlackChannelsRetryAt(retryAt)
      } else {
        slackChannelsRetryAtRef.current = null
        setSlackChannelsRetryAt(null)
      }
      setSlackChannels(null)
      setSlackChannelsLoadState('error')
      return null
    } finally {
      if (
        currentOrganizationScopeRef.current === requestScope
        && slackChannelsRequestRef.current === controller
      ) slackChannelsRequestRef.current = null
    }
  }, [dashboard.organization.id, demoMode, onAuthenticationRequired])

  const loadSummary = useCallback(async (signal?: AbortSignal, quiet = false) => {
    const requestOrganizationId = dashboard.organization.id
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return null
    if (demoMode) {
      if (currentOrganizationScopeRef.current !== requestScope) return null
      setSummary(DEMO_SUMMARY)
      initializeSlackDeliveryDraft(DEMO_SUMMARY)
      setLoadState('ready')
      return DEMO_SUMMARY
    }
    if (!quiet) setLoadState('loading')
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) return null
    try {
      const next = await fetchCompanyMailboxSummary(requestOrganizationId, signal)
      if (signal?.aborted || currentOrganizationScopeRef.current !== requestScope) return null
      retryAtRef.current = null
      if (next.status === 'ready') requestKeyRef.current = null
      setSummary(next)
      initializeSlackDeliveryDraft(next)
      setLoadState('ready')
      return next
    } catch (error) {
      if (
        signal?.aborted
        || currentOrganizationScopeRef.current !== requestScope
        || (error instanceof DOMException && error.name === 'AbortError')
      ) return null
      if (error instanceof CompanyMailboxHttpError && error.status === 401) {
        onAuthenticationRequired()
        return null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        retryAtRef.current = Date.now() + error.retryAfterMs
        if (quiet) return null
      } else {
        retryAtRef.current = null
      }
      setNotice({ tone: 'error', message: userFacingErrorMessage(error, 'Company email is temporarily unavailable.') })
      setLoadState('error')
      return null
    }
  }, [dashboard.organization.id, demoMode, initializeSlackDeliveryDraft, onAuthenticationRequired])

  useEffect(() => {
    setLocalPart('memcode')
    setDisplayName(`${dashboard.organization.name} Company Brain`)
    setNotice(null)
    setCreating(false)
    setSavingSlackDelivery(false)
    setSlackChannels(null)
    setSlackChannelsLoadState('idle')
    setSlackChannelsRetryAt(null)
    setSlackDeliveryEnabled(false)
    setSlackDeliveryChannelId('')
    setMailboxActionRetryAt(null)
    setMailboxActionNow(Date.now())
    requestKeyRef.current = null
    slackDeliveryAttemptRef.current = null
    slackDeliveryDraftInitializedRef.current = false
    slackChannelsRetryAtRef.current = null
    retryAtRef.current = null
    const controller = new AbortController()
    let timer: number | undefined
    const poll = async () => {
      const next = await loadSummary(controller.signal, timer !== undefined)
      const retryAt = retryAtRef.current
      if (!controller.signal.aborted && next === null && retryAt !== null) {
        timer = window.setTimeout(
          () => void poll(),
          Math.max(0, retryAt - Date.now()),
        )
      }
    }
    void Promise.all([poll(), loadSlackChannels()])
    return () => {
      controller.abort()
      const channelRequest = slackChannelsRequestRef.current
      slackChannelsRequestRef.current = null
      channelRequest?.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [dashboard.organization.id, dashboard.organization.name, loadSlackChannels, loadSummary])

  useEffect(() => {
    if (loadState !== 'ready' || summary?.status !== 'provisioning') return undefined
    const controller = new AbortController()
    let timer: number | undefined
    const poll = () => {
      const retryAt = retryAtRef.current
      timer = window.setTimeout(async () => {
        const next = await loadSummary(controller.signal, true)
        if (!controller.signal.aborted && next?.status === 'ready') {
          requestKeyRef.current = null
          const expectedTeamId = slackChannels?.status === 'ready' ? slackChannels.teamId : null
          const slackDeliveryRecovered = !slackDeliveryEnabled || (
            next.slackDelivery.enabled
            && next.slackDelivery.teamId === expectedTeamId
            && next.slackDelivery.channelId === slackDeliveryChannelId
          )
          if (slackDeliveryRecovered) setMailboxActionRetryAt(null)
          setNotice({
            tone: slackDeliveryRecovered ? 'success' : 'error',
            message: slackDeliveryRecovered
              ? 'Company email is ready.'
              : 'Company email is ready. Use Save Slack delivery below when the button is available.',
          })
        }
        if (
          !controller.signal.aborted
          && (next?.status === 'provisioning' || retryAtRef.current !== null)
        ) poll()
      }, retryAt === null ? 2_500 : Math.max(0, retryAt - Date.now()))
    }
    poll()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    loadState,
    loadSummary,
    slackChannels,
    slackDeliveryChannelId,
    slackDeliveryEnabled,
    summary?.status,
  ])

  useEffect(() => {
    if (mailboxActionRetryAt === null) return undefined
    const remainingMs = mailboxActionRetryAt - Date.now()
    if (remainingMs <= 0) {
      setMailboxActionRetryAt(null)
      return undefined
    }
    setMailboxActionNow(Date.now())
    const interval = window.setInterval(() => setMailboxActionNow(Date.now()), 1_000)
    const timeout = window.setTimeout(() => {
      setMailboxActionNow(Date.now())
      setMailboxActionRetryAt(null)
    }, remainingMs + 20)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [mailboxActionRetryAt])

  const domain = previewDomain(summary)
  const normalizedLocalPart = localPart.trim().toLowerCase()
  const addressPreview = `${normalizedLocalPart || 'memcode'}@${domain}`
  const validLocalPart = LOCAL_PART.test(normalizedLocalPart)
  const canManage = summary?.canManage === true
  const slackTeamId = slackChannels?.status === 'ready' ? slackChannels.teamId : null
  const selectedSlackChannel = slackChannels?.channels.find((channel) => channel.id === slackDeliveryChannelId)
  const slackDeliveryChannelValid = Boolean(slackTeamId && selectedSlackChannel)
  const mailboxActionRetrySeconds = mailboxActionRetryAt === null
    ? 0
    : Math.max(0, Math.ceil((mailboxActionRetryAt - mailboxActionNow) / 1_000))
  const createRequestPending = requestKeyRef.current !== null
  const slackDeliveryDirty = summary !== null && (
    slackDeliveryEnabled !== summary.slackDelivery.enabled
    || (slackDeliveryEnabled && (
      slackTeamId !== summary.slackDelivery.teamId
      || slackDeliveryChannelId !== summary.slackDelivery.channelId
    ))
  )

  useEffect(() => {
    if (!summary || slackChannelsLoadState !== 'ready' || slackChannels?.status !== 'ready') return
    if (!slackDeliveryChannelId) return
    const listed = slackChannels.channels.some((channel) => channel.id === slackDeliveryChannelId)
    const savedForCurrentTeam = Boolean(
      summary.slackDelivery.channelId === slackDeliveryChannelId
      && summary.slackDelivery.teamId
      && summary.slackDelivery.teamId === slackChannels.teamId,
    )
    if (listed || savedForCurrentTeam) return
    if (requestKeyRef.current !== null) return
    setSlackDeliveryChannelId('')
    requestKeyRef.current = null
    slackDeliveryAttemptRef.current = null
  }, [slackChannels, slackChannelsLoadState, slackDeliveryChannelId, summary])

  const handleSlackDeliveryEnabledChange = useCallback((enabled: boolean) => {
    setSlackDeliveryEnabled(enabled)
    requestKeyRef.current = null
    slackDeliveryAttemptRef.current = null
    setNotice(null)
  }, [])

  const handleSlackDeliveryChannelChange = useCallback((channelId: string) => {
    setSlackDeliveryChannelId(channelId)
    requestKeyRef.current = null
    slackDeliveryAttemptRef.current = null
    setNotice(null)
  }, [])

  const retrySlackChannels = useCallback(() => {
    void loadSlackChannels()
  }, [loadSlackChannels])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const requestOrganizationId = dashboard.organization.id
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return
    if (mailboxActionRetryAt !== null && Date.now() < mailboxActionRetryAt) return
    if (!summary || !canManage || creating || summary.status === 'ready' || summary.status === 'provisioning') return
    if (!validLocalPart) {
      setNotice({ tone: 'error', message: 'Use lowercase letters, numbers, dots, dashes, or underscores for the email name.' })
      return
    }
    if (slackDeliveryEnabled && !slackDeliveryChannelValid) {
      setNotice({ tone: 'error', message: 'Choose one public Slack channel, or turn Slack delivery off.' })
      return
    }
    if (!requestKeyRef.current) requestKeyRef.current = `company-mailbox:${crypto.randomUUID()}`
    setCreating(true)
    setNotice(null)
    try {
      const result = demoMode
        ? {
            summary: {
              ...DEMO_SUMMARY,
              status: 'ready' as const,
              address: addressPreview,
              displayName: displayName.trim() || `${dashboard.organization.name} Company Brain`,
              slackDelivery: slackDeliveryEnabled
                ? {
                    available: true,
                    enabled: true,
                    teamId: slackTeamId,
                    channelId: slackDeliveryChannelId,
                    channelName: selectedSlackChannel?.name ?? null,
                    lastError: null,
                    updatedAt: new Date().toISOString(),
                  }
                : DEMO_SUMMARY.slackDelivery,
              updatedAt: new Date().toISOString(),
            },
            replayed: false,
          }
        : await createCompanyMailbox(requestOrganizationId, {
            localPart: normalizedLocalPart,
            displayName: displayName.trim() || `${dashboard.organization.name} Company Brain`,
            ...(slackDeliveryEnabled && slackTeamId ? {
              slackDelivery: {
                enabled: true as const,
                teamId: slackTeamId,
                channelId: slackDeliveryChannelId,
              },
            } : {}),
          }, requestKeyRef.current)
      if (currentOrganizationScopeRef.current !== requestScope) return
      setSummary(result.summary)
      setSlackDeliveryEnabled(result.summary.slackDelivery.enabled)
      setSlackDeliveryChannelId(result.summary.slackDelivery.channelId ?? '')
      slackDeliveryDraftInitializedRef.current = true
      requestKeyRef.current = null
      setMailboxActionRetryAt(null)
      setNotice({ tone: 'success', message: result.replayed ? 'Company email is ready.' : 'Company email created.' })
    } catch (error) {
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (error instanceof CompanyMailboxHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (error instanceof CompanyMailboxHttpError && error.status < 500 && error.status !== 429) {
        requestKeyRef.current = null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        const retryAt = Date.now() + error.retryAfterMs
        setMailboxActionNow(Date.now())
        setMailboxActionRetryAt(retryAt)
      }
      const recoveredSummary = await loadSummary(undefined, true)
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (recoveredSummary?.status === 'ready') {
        requestKeyRef.current = null
        const slackDeliveryRecovered = !slackDeliveryEnabled || (
          recoveredSummary.slackDelivery.enabled
          && recoveredSummary.slackDelivery.teamId === slackTeamId
          && recoveredSummary.slackDelivery.channelId === slackDeliveryChannelId
        )
        if (slackDeliveryRecovered) setMailboxActionRetryAt(null)
        setNotice({
          tone: slackDeliveryRecovered ? 'success' : 'error',
          message: slackDeliveryRecovered
            ? 'Company email is ready.'
            : 'Company email is ready. Use Save Slack delivery below when the button is available.',
        })
        return
      }
      if (recoveredSummary?.status === 'provisioning') {
        setNotice({ tone: 'success', message: 'Company email setup is still finishing.' })
        return
      }
      setNotice({ tone: 'error', message: userFacingErrorMessage(error, 'The company email could not be created.') })
    } finally {
      if (currentOrganizationScopeRef.current === requestScope) setCreating(false)
    }
  }

  const saveSlackDelivery = async () => {
    const requestOrganizationId = dashboard.organization.id
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return
    if (mailboxActionRetryAt !== null && Date.now() < mailboxActionRetryAt) return
    if (!summary || summary.status !== 'ready' || !canManage || savingSlackDelivery || !slackDeliveryDirty) return
    if (slackDeliveryEnabled && !slackDeliveryChannelValid) {
      setNotice({ tone: 'error', message: 'Choose one public Slack channel, or turn Slack delivery off.' })
      return
    }
    const signature = slackDeliveryEnabled
      ? `enabled\n${slackTeamId}\n${slackDeliveryChannelId}`
      : 'disabled'
    if (slackDeliveryAttemptRef.current?.signature !== signature) {
      slackDeliveryAttemptRef.current = {
        signature,
        idempotencyKey: `company-mailbox-slack:${crypto.randomUUID()}`,
      }
    }
    setSavingSlackDelivery(true)
    setNotice(null)
    try {
      const result = demoMode
        ? {
            summary: {
              ...summary,
              slackDelivery: slackDeliveryEnabled
                ? {
                    available: true,
                    enabled: true,
                    teamId: slackTeamId,
                    channelId: slackDeliveryChannelId,
                    channelName: selectedSlackChannel?.name ?? null,
                    lastError: null,
                    updatedAt: new Date().toISOString(),
                  }
                : {
                    ...summary.slackDelivery,
                    enabled: false,
                    channelId: null,
                    channelName: null,
                    lastError: null,
                    updatedAt: new Date().toISOString(),
                  },
            },
            replayed: false,
          }
        : await updateCompanyMailboxSlackDelivery(
            requestOrganizationId,
            slackDeliveryEnabled && slackTeamId
              ? { enabled: true, teamId: slackTeamId, channelId: slackDeliveryChannelId }
              : { enabled: false },
            slackDeliveryAttemptRef.current.idempotencyKey,
          )
      if (currentOrganizationScopeRef.current !== requestScope) return
      setSummary(result.summary)
      setSlackDeliveryEnabled(result.summary.slackDelivery.enabled)
      setSlackDeliveryChannelId(result.summary.slackDelivery.channelId ?? '')
      slackDeliveryAttemptRef.current = null
      setMailboxActionRetryAt(null)
      setNotice({
        tone: 'success',
        message: result.summary.slackDelivery.enabled
          ? `New Company Email messages will be sent to #${result.summary.slackDelivery.channelName || selectedSlackChannel?.name || 'the selected channel'}.`
          : 'Slack delivery is off. New messages will stay in the Company Mail Inbox.',
      })
    } catch (error) {
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (error instanceof CompanyMailboxHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (error instanceof CompanyMailboxHttpError && error.status < 500 && error.status !== 429) {
        slackDeliveryAttemptRef.current = null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        const retryAt = Date.now() + error.retryAfterMs
        setMailboxActionNow(Date.now())
        setMailboxActionRetryAt(retryAt)
      }
      setNotice({ tone: 'error', message: userFacingErrorMessage(error, 'Slack delivery could not be updated.') })
    } finally {
      if (currentOrganizationScopeRef.current === requestScope) setSavingSlackDelivery(false)
    }
  }

  if (loadState === 'loading') {
    return <section className="brain-runtime-settings brain-runtime-settings--state" role="status">Loading company email…</section>
  }
  if (loadState === 'error' || !summary) {
    return (
      <section className="brain-runtime-settings brain-runtime-settings--state" aria-labelledby="brain-company-mail-error-title">
        <h1 id="brain-company-mail-error-title">Company email is unavailable.</h1>
        <p>{notice?.message ?? 'Company email is temporarily unavailable.'}</p>
        <button type="button" onClick={() => void loadSummary()}>Try again</button>
      </section>
    )
  }

  const locked = summary.status === 'ready' || summary.status === 'provisioning'
  return (
    <section className="brain-runtime-settings brain-agentmail-settings" aria-labelledby="brain-company-mail-title">
      <header className="brain-runtime-settings__header">
        <div>
          <span className="brain-agentmail-settings__eyebrow">Company email</span>
          <h1 id="brain-company-mail-title">An inbox for Company Brain.</h1>
          <p>Create an address your agents can use to receive mail and send through the existing approval flow.</p>
        </div>
        <div className="brain-runtime-settings__status" aria-label="Current company email status">
          <span>Mailbox</span>
          <strong>{statusLabel(summary)}</strong>
          <small>{summary.address ?? addressPreview}</small>
        </div>
      </header>

      {!canManage ? (
        <div className="brain-runtime-settings__notice" role="status">
          You can review this mailbox. An organization admin or owner can configure it.
        </div>
      ) : null}
      {notice ? (
        <div className={`brain-runtime-settings__notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </div>
      ) : null}

      <form className="brain-runtime-settings__configuration brain-agentmail-settings__configuration" onSubmit={(event) => void create(event)}>
        <section className="brain-runtime-settings__column" aria-labelledby="brain-company-mail-address-title">
          <div className="brain-runtime-settings__section-heading">
            <span>01</span>
            <div>
              <h2 id="brain-company-mail-address-title">Choose the address</h2>
              <p>Pick the name before the @. The full address stays dedicated to this organization.</p>
            </div>
          </div>
          {summary.status === 'ready' ? (
            <div className="brain-agentmail-settings__inbox-card">
              <span>Active address</span>
              <strong>{summary.address}</strong>
              <small>{summary.displayName || dashboard.organization.name}</small>
            </div>
          ) : (
            <>
              <label className="brain-runtime-settings__field">
                <span>Email name</span>
                <input
                  value={localPart}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!canManage || creating || locked || createRequestPending}
                  aria-invalid={normalizedLocalPart.length > 0 && !validLocalPart}
                  onChange={(event) => {
                    setLocalPart(event.target.value.toLowerCase())
                    requestKeyRef.current = null
                    setNotice(null)
                  }}
                />
                <small>Letters, numbers, dots, dashes and underscores.</small>
              </label>
              <div className="brain-agentmail-settings__inbox-card" aria-live="polite">
                <span>Your Company Brain email</span>
                <strong>{addressPreview}</strong>
                <small>The final address is confirmed when you create it.</small>
              </div>
            </>
          )}
        </section>

        <section className="brain-runtime-settings__column" aria-labelledby="brain-company-mail-identity-title">
          <div className="brain-runtime-settings__section-heading">
            <span>02</span>
            <div>
              <h2 id="brain-company-mail-identity-title">Mailbox identity</h2>
              <p>This name appears when Company Brain sends approved mail.</p>
            </div>
          </div>
          <label className="brain-runtime-settings__field">
            <span>Display name</span>
            <input
              value={displayName}
              maxLength={100}
              disabled={!canManage || creating || locked || createRequestPending}
              onChange={(event) => {
                setDisplayName(event.target.value)
                requestKeyRef.current = null
                setNotice(null)
              }}
            />
          </label>
          <p className="brain-agentmail-settings__alternative">
            Planning to use Gmail or another existing address? Leave this unconfigured. You can return later.
          </p>
          <CompanyMailboxSlackDelivery
            channels={slackChannels}
            loadState={slackChannelsLoadState}
            enabled={slackDeliveryEnabled}
            selectedChannelId={slackDeliveryChannelId}
            currentTeamId={summary.slackDelivery.teamId}
            currentChannelId={summary.slackDelivery.channelId}
            currentChannelName={summary.slackDelivery.channelName}
            retryAt={slackChannelsRetryAt}
            disabled={!canManage || creating || savingSlackDelivery || createRequestPending}
            onEnabledChange={handleSlackDeliveryEnabledChange}
            onChannelChange={handleSlackDeliveryChannelChange}
            onRetry={retrySlackChannels}
          />
          {summary.slackDelivery.lastError ? (
            <p className="brain-agentmail-settings__delivery-error" role="status">
              The last Slack delivery did not complete. Check the selected channel or reconnect Slack.
            </p>
          ) : null}
          {summary.status === 'ready' ? (
            <button
              className="brain-agentmail-settings__primary"
              type="button"
              disabled={
                !canManage
                || savingSlackDelivery
                || mailboxActionRetrySeconds > 0
                || !slackDeliveryDirty
                || (slackDeliveryEnabled && !slackDeliveryChannelValid)
              }
              onClick={() => void saveSlackDelivery()}
            >
              {savingSlackDelivery
                ? 'Saving Slack delivery…'
                : mailboxActionRetrySeconds > 0
                  ? `Try again in ${mailboxActionRetrySeconds}s`
                  : 'Save Slack delivery'}
            </button>
          ) : (
            <button className="brain-agentmail-settings__primary" type="submit" disabled={!canManage || creating || mailboxActionRetrySeconds > 0 || locked || !validLocalPart || (slackDeliveryEnabled && !slackDeliveryChannelValid)}>
              {creating
                ? 'Creating company email…'
                : mailboxActionRetrySeconds > 0
                  ? `Try again in ${mailboxActionRetrySeconds}s`
                  : summary.status === 'failed'
                    ? 'Retry company email'
                    : createRequestPending
                      ? 'Retry company email'
                    : locked
                      ? statusLabel(summary)
                      : 'Create company email'}
            </button>
          )}
        </section>
      </form>
    </section>
  )
}
