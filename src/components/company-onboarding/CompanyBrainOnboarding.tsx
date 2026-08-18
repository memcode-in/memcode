import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  BrainIntegrationHttpError,
  connectBrainIntegration,
  fetchBrainIntegrations,
} from '../../lib/brain-integrations'
import {
  COMPANY_RESEARCH_EDIT_LIMITS,
  CompanyOnboardingHttpError,
  completeCompanyOnboarding,
  fetchCurrentSlackHistorySync,
  fetchCompanyOnboarding,
  fetchSlackHistoryChannels,
  fetchSlackHistorySyncRun,
  estimateSlackHistorySync,
  parseSlackHistorySyncRun,
  queueSlackHistorySync,
  startEstimatedSlackHistorySync,
  startCompanyResearch,
  updateCompanyResearchCard,
  type CompanyOnboardingStatus,
  type CompanyOnboardingSnapshot,
  type CompanyResearchCard,
  type CompanyResearchCardUpdateInput,
  type CompanyResearchRun,
  type CompanyResearchSource,
  type SlackHistoryChannel,
  type SlackHistoryChannels,
  type SlackHistorySyncRun,
} from '../../lib/brain-onboarding'
import {
  CompanyMailboxHttpError,
  createCompanyMailbox,
  fetchCompanyMailboxSlackChannels,
  fetchCompanyMailboxSummary,
  skipCompanyMailbox,
  type CompanyMailboxSlackChannels,
  type CompanyMailboxSummary,
} from '../../lib/brain-company-mailbox'
import {
  INTEGRATION_ERROR_MESSAGES,
  ONBOARDING_ERROR_MESSAGES,
  userFacingCodeMessage,
  userFacingErrorMessage,
} from '../../lib/user-facing-errors'
import SlackMark from '../SlackMark'
import CompanyMailboxSlackDelivery, {
  type CompanyMailboxSlackChannelsLoadState,
} from '../CompanyMailboxSlackDelivery'
import './company-brain-onboarding.css'

interface CompanyBrainOnboardingProps {
  organizationId: string
  initialDomain?: string | null
  initialOrganizationName?: string | null
  reopenToken: number
  openRequested: boolean
  onAuthenticationRequired: () => void
  onCompleted: () => Promise<unknown> | unknown
  onIncompleteChange: (incomplete: boolean) => void
  onOpenChange: (open: boolean) => void
  onSetupStatusChange: (status: CompanyOnboardingStatus) => void
  onOpenAccount: () => void
  onOpenConnectors: () => void
  onSlackHistoryStarted?: () => void
}

interface Notice {
  tone: 'error' | 'info'
  message: string
}

const RESEARCH_PHASES = [
  { key: 'queued', label: 'Preparing a private research run' },
  { key: 'agent_start', label: 'Starting company research' },
  { key: 'agent_wait', label: 'Gathering and verifying public evidence' },
  { key: 'memory_ingest', label: 'Saving verified company knowledge to memory' },
  { key: 'ready', label: 'Research brief ready to review' },
] as const

const POLL_INTERVAL_MS = 2_500
const SLACK_PROVISIONING_POLL_LIMIT = 48
const SLACK_HISTORY_SKIP_KEY_PREFIX = 'memcode:company-brain:slack-history-skipped:'
const SLACK_HISTORY_QUEUED_KEY_PREFIX = 'memcode:company-brain:slack-history-queued:'
const SLACK_HISTORY_ESTIMATE_KEY_PREFIX = 'memcode:company-brain:slack-history-estimate:'
const SLACK_HISTORY_DIRECT_MAX_DAYS = 14
const SLACK_HISTORY_MAX_DAYS = 365

type SlackHistoryStep = 'idle' | 'connected' | 'channels' | 'estimate' | 'mailbox' | 'queued'
type SlackHistoryLoadState = 'idle' | 'loading' | 'ready' | 'error'
type MailboxLoadState = 'idle' | 'loading' | 'ready' | 'error'
const MAILBOX_LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u

export default function CompanyBrainOnboarding({
  organizationId,
  initialDomain,
  initialOrganizationName,
  reopenToken,
  openRequested,
  onAuthenticationRequired,
  onCompleted,
  onIncompleteChange,
  onOpenChange,
  onSetupStatusChange,
  onOpenAccount,
  onOpenConnectors,
  onSlackHistoryStarted,
}: CompanyBrainOnboardingProps) {
  const [slackCallbackRecognized] = useState(slackCallbackFromLocation)
  const [persistedSlackHistorySync] = useState(() => readQueuedSlackHistorySync(organizationId))
  const [persistedSlackHistoryEstimate] = useState(() => readSlackHistoryEstimate(organizationId))
  const [snapshot, setSnapshot] = useState<CompanyOnboardingSnapshot | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [dismissed, setDismissed] = useState(() => (
    slackCallbackRecognized ? false : readSlackHistorySkipped(organizationId)
  ))
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [activeCard, setActiveCard] = useState(0)
  const [correctingDomain, setCorrectingDomain] = useState(false)
  const [editingResearchCardKey, setEditingResearchCardKey] = useState<string | null>(null)
  const [slackHistoryStep, setSlackHistoryStep] = useState<SlackHistoryStep>(
    slackCallbackRecognized ? 'connected' : 'idle',
  )
  const [slackHistoryIncomplete, setSlackHistoryIncomplete] = useState(() => (
    slackCallbackRecognized
    || readSlackHistorySkipped(organizationId)
    || persistedSlackHistorySync !== null
    || persistedSlackHistoryEstimate !== null
  ))
  const [slackHistoryLoadState, setSlackHistoryLoadState] = useState<SlackHistoryLoadState>('idle')
  const [slackHistoryChannels, setSlackHistoryChannels] = useState<SlackHistoryChannels | null>(null)
  const [selectedSlackChannelIds, setSelectedSlackChannelIds] = useState<Set<string>>(() => new Set())
  const [slackProactivityEnabled, setSlackProactivityEnabled] = useState(
    persistedSlackHistoryEstimate?.proactivityEnabled
      ?? persistedSlackHistorySync?.proactivityEnabled
      ?? false,
  )
  const [slackChannelSearch, setSlackChannelSearch] = useState('')
  const [slackHistoryWindowDays, setSlackHistoryWindowDays] = useState(
    persistedSlackHistoryEstimate?.run.windowDays ?? persistedSlackHistorySync?.run.windowDays ?? 7,
  )
  const [slackHistoryEstimateRun, setSlackHistoryEstimateRun] = useState<SlackHistorySyncRun | null>(
    persistedSlackHistoryEstimate?.run ?? null,
  )
  const [slackHistoryEstimateChannelCount, setSlackHistoryEstimateChannelCount] = useState(
    persistedSlackHistoryEstimate?.channelCount ?? 0,
  )
  const [slackHistorySyncRun, setSlackHistorySyncRun] = useState<SlackHistorySyncRun | null>(
    persistedSlackHistorySync?.run ?? null,
  )
  const [slackHistoryQueuedChannelCount, setSlackHistoryQueuedChannelCount] = useState(
    persistedSlackHistorySync?.channelCount ?? 0,
  )
  const [slackProvisioningPolls, setSlackProvisioningPolls] = useState(0)
  const [mailboxSummary, setMailboxSummary] = useState<CompanyMailboxSummary | null>(null)
  const [mailboxLoadState, setMailboxLoadState] = useState<MailboxLoadState>('idle')
  const [mailboxLocalPart, setMailboxLocalPart] = useState('memcode')
  const [mailboxDisplayName, setMailboxDisplayName] = useState(`${initialOrganizationName || 'Company'} Company Brain`)
  const [mailboxSlackChannels, setMailboxSlackChannels] = useState<CompanyMailboxSlackChannels | null>(null)
  const [mailboxSlackChannelsLoadState, setMailboxSlackChannelsLoadState] = useState<CompanyMailboxSlackChannelsLoadState>('idle')
  const [mailboxSlackChannelsRetryAt, setMailboxSlackChannelsRetryAt] = useState<number | null>(null)
  const [mailboxSlackDeliveryEnabled, setMailboxSlackDeliveryEnabled] = useState(false)
  const [mailboxSlackDeliveryChannelId, setMailboxSlackDeliveryChannelId] = useState('')
  const [mailboxActionRetryAt, setMailboxActionRetryAt] = useState<number | null>(null)
  const [mailboxActionNow, setMailboxActionNow] = useState(() => Date.now())
  const [mailboxIncomplete, setMailboxIncomplete] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const previousOrganizationIdRef = useRef(organizationId)
  const currentOrganizationScopeRef = useRef({ organizationId })
  if (currentOrganizationScopeRef.current.organizationId !== organizationId) {
    currentOrganizationScopeRef.current = { organizationId }
  }
  const previousReopenTokenRef = useRef(reopenToken)
  const reopenRequestedRef = useRef(false)
  const slackChannelSelectionInitializedRef = useRef(false)
  const researchAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const slackHistoryRequestRef = useRef<AbortController | null>(null)
  const slackSyncAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const slackEstimateAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const slackEstimateStartAttemptRef = useRef<{ runId: string; idempotencyKey: string } | null>(null)
  const mailboxRequestRef = useRef<AbortController | null>(null)
  const mailboxSlackChannelsRequestRef = useRef<AbortController | null>(null)
  const mailboxSlackChannelsRetryAtRef = useRef<number | null>(null)
  const mailboxCreateAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const mailboxSlackDeliveryDraftInitializedRef = useRef(false)
  const mailboxSkipRef = useRef<() => void>(() => undefined)
  const mailboxRetryAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (previousOrganizationIdRef.current === organizationId) return
    previousOrganizationIdRef.current = organizationId

    const summaryRequest = mailboxRequestRef.current
    mailboxRequestRef.current = null
    summaryRequest?.abort()
    const channelsRequest = mailboxSlackChannelsRequestRef.current
    mailboxSlackChannelsRequestRef.current = null
    channelsRequest?.abort()

    mailboxSlackDeliveryDraftInitializedRef.current = false
    mailboxCreateAttemptRef.current = null
    mailboxRetryAtRef.current = null
    mailboxSlackChannelsRetryAtRef.current = null
    setMailboxSummary(null)
    setMailboxLoadState('idle')
    setMailboxSlackChannels(null)
    setMailboxSlackChannelsLoadState('idle')
    setMailboxSlackChannelsRetryAt(null)
    setMailboxSlackDeliveryEnabled(false)
    setMailboxSlackDeliveryChannelId('')
    setMailboxActionRetryAt(null)
    setMailboxActionNow(Date.now())
    setMailboxIncomplete(false)
    setSlackProactivityEnabled(false)
    researchAttemptRef.current = null
    setCorrectingDomain(false)
    setEditingResearchCardKey(null)
    setBusyAction(null)
    setNotice(null)
  }, [organizationId])

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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchCompanyOnboarding(signal)
      setSnapshot(next)
      setLoadState('ready')
      return next
    } catch (error) {
      if (signal?.aborted) return null
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return null
      }
      setLoadState('unavailable')
      return null
    }
  }, [onAuthenticationRequired])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!slackCallbackRecognized) return
    writeSlackHistorySkipped(organizationId, false)
    writeQueuedSlackHistorySync(organizationId, null)
    writeSlackHistoryEstimate(organizationId, null)
    setSlackHistorySyncRun(null)
    setSlackHistoryQueuedChannelCount(0)
    setSlackHistoryEstimateRun(null)
    setSlackHistoryEstimateChannelCount(0)
    setSlackProactivityEnabled(false)
    const url = new URL(window.location.href)
    if (url.searchParams.get('onboarding') === 'slack') {
      url.searchParams.delete('onboarding')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [organizationId, slackCallbackRecognized])

  useEffect(() => {
    if (previousReopenTokenRef.current === reopenToken) return
    previousReopenTokenRef.current = reopenToken
    reopenRequestedRef.current = true
    writeSlackHistorySkipped(organizationId, false)
    setDismissed(false)
    setNotice(null)
    if (slackHistoryEstimateRun) {
      setSlackHistoryIncomplete(true)
      setSlackHistoryStep('estimate')
      reopenRequestedRef.current = false
    } else if (slackHistorySyncRun) {
      setSlackHistoryIncomplete(true)
      setSlackHistoryStep('mailbox')
      reopenRequestedRef.current = false
    } else if (snapshot?.slackConnected) {
      setSlackHistoryIncomplete(true)
      setSlackHistoryStep('connected')
      reopenRequestedRef.current = false
    } else {
      setSlackHistoryIncomplete(false)
      setSlackHistoryStep('idle')
      if (snapshot) reopenRequestedRef.current = false
    }
  }, [organizationId, reopenToken, slackHistoryEstimateRun, slackHistorySyncRun, snapshot?.slackConnected])

  useEffect(() => {
    if (loadState !== 'ready' || !snapshot) return
    const skipped = readSlackHistorySkipped(organizationId)
    const queuedSync = readQueuedSlackHistorySync(organizationId)
    const pendingEstimate = readSlackHistoryEstimate(organizationId)
    if (reopenRequestedRef.current && snapshot.slackConnected) {
      reopenRequestedRef.current = false
      setSlackHistoryStep(slackHistoryEstimateRun ? 'estimate' : slackHistorySyncRun ? 'mailbox' : 'connected')
      setSlackHistoryIncomplete(true)
      return
    }
    if (
      !slackCallbackRecognized
      && slackHistoryStep === 'idle'
      && snapshot.status !== 'completed'
      && snapshot.slackConnected
      && !skipped
      && !queuedSync
      && !pendingEstimate
      && !dismissed
    ) {
      setSlackHistoryStep('connected')
      setSlackHistoryIncomplete(true)
    }
  }, [
    dismissed,
    loadState,
    organizationId,
    slackCallbackRecognized,
    slackHistoryStep,
    slackHistoryEstimateRun,
    slackHistorySyncRun,
    snapshot,
  ])

  useEffect(() => {
    if (loadState !== 'ready' || !snapshot) return
    onIncompleteChange(snapshot.status !== 'completed' || slackHistoryIncomplete || mailboxIncomplete)
    onSetupStatusChange(snapshot.status)
  }, [loadState, mailboxIncomplete, onIncompleteChange, onSetupStatusChange, slackHistoryIncomplete, snapshot])

  useEffect(() => () => {
    slackHistoryRequestRef.current?.abort()
    mailboxRequestRef.current?.abort()
    mailboxSlackChannelsRequestRef.current?.abort()
  }, [])

  const researchIsActive = snapshot?.run?.status === 'queued' || snapshot?.run?.status === 'running'
  const memoryPublicationIsActive = snapshot?.slackConnected === true
    && (snapshot.run?.memoryStatus === 'pending' || snapshot.run?.memoryStatus === 'processing')
  const onboardingWorkIsActive = researchIsActive || memoryPublicationIsActive

  useEffect(() => {
    if (!onboardingWorkIsActive) return
    let stopped = false
    let polling = false
    const timer = window.setInterval(() => {
      if (stopped || polling || document.visibilityState === 'hidden') return
      polling = true
      void refresh().finally(() => {
        polling = false
      })
    }, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [refresh, onboardingWorkIsActive])

  const slackHistoryActive = slackHistoryStep !== 'idle'
  const visibleSlackHistoryChannels = useMemo(() => {
    const channels = slackHistoryChannels?.channels ?? []
    const query = slackChannelSearch.trim().toLocaleLowerCase()
    if (!query) return channels
    return channels.filter((channel) => (
      channel.name.toLocaleLowerCase().includes(query)
      || channel.topic?.toLocaleLowerCase().includes(query)
      || channel.purpose?.toLocaleLowerCase().includes(query)
    ))
  }, [slackChannelSearch, slackHistoryChannels?.channels])
  const visible = loadState === 'ready'
    && snapshot !== null
    && (snapshot.status !== 'completed' || slackHistoryActive)
    && snapshot.canManage
    && !dismissed
    && (openRequested || slackCallbackRecognized)

  useEffect(() => {
    if (!visible) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])',
    )
    focusable?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [visible])

  useEffect(() => {
    if (!visible || !slackHistoryActive) return
    dialogRef.current
      ?.querySelector<HTMLElement>('#brain-onboarding-title')
      ?.focus({ preventScroll: true })
  }, [slackHistoryActive, slackHistoryStep, visible])

  useEffect(() => {
    const cardCount = (snapshot?.run?.cards.length ?? 0) + 1
    setActiveCard((current) => Math.min(current, Math.max(0, cardCount - 1)))
  }, [snapshot?.run?.cards.length])

  const showResearchEditLockNotice = useCallback(() => {
    setNotice((current) => current?.tone === 'error'
      ? current
      : { tone: 'info', message: 'Save or cancel your edit before leaving the research brief.' })
  }, [])

  const dismiss = useCallback(() => {
    if (editingResearchCardKey !== null) {
      showResearchEditLockNotice()
      return
    }
    setDismissed(true)
    onOpenChange(false)
    setNotice(null)
  }, [editingResearchCardKey, onOpenChange, showResearchEditLockNotice])

  const handleResearchCardEditingChange = useCallback((cardKey: string, editing: boolean) => {
    setEditingResearchCardKey((current) => editing ? cardKey : current === cardKey ? null : current)
  }, [])

  const skipSlackHistory = useCallback(() => {
    writeSlackHistorySkipped(organizationId, true)
    setSlackHistoryIncomplete(true)
    setSlackHistoryStep('mailbox')
    setNotice(null)
    onIncompleteChange(true)
  }, [onIncompleteChange, organizationId])

  const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (editingResearchCardKey !== null) {
        showResearchEditLockNotice()
        return
      }
      if (busyAction !== null) return
      if (
        slackHistoryStep === 'connected'
        || slackHistoryStep === 'channels'
        || slackHistoryStep === 'estimate'
      ) skipSlackHistory()
      else if (slackHistoryStep === 'mailbox') mailboxSkipRef.current()
      else if (slackHistoryActive) dismiss()
      else dismiss()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])',
    ) ?? [])].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [busyAction, dismiss, editingResearchCardKey, showResearchEditLockNotice, skipSlackHistory, slackHistoryActive, slackHistoryStep])

  const runResearch = useCallback(async (domain: string) => {
    const signature = normalizeDomainInput(domain)
    if (researchAttemptRef.current?.signature !== signature) {
      researchAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() }
    }
    setBusyAction('research')
    setNotice(null)
    try {
      const next = await startCompanyResearch(signature, researchAttemptRef.current.idempotencyKey)
      researchAttemptRef.current = null
      setSnapshot(next)
      setActiveCard(0)
      setCorrectingDomain(false)
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'Company research could not be started.'),
      })
    } finally {
      setBusyAction(null)
    }
  }, [onAuthenticationRequired])

  const updateResearchCard = useCallback(async (input: CompanyResearchCardUpdateInput) => {
    if (busyAction !== null) return false
    setBusyAction(`research-card:${input.cardKey}`)
    setNotice(null)
    try {
      const next = await updateCompanyResearchCard(input)
      setSnapshot(next)
      return true
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return false
      }
      if (error instanceof CompanyOnboardingHttpError && error.code === 'stale_research_step') {
        try {
          const latest = await fetchCompanyOnboarding()
          setSnapshot(latest)
          setEditingResearchCardKey((current) => current === input.cardKey ? null : current)
        } catch (refreshError) {
          if (isAuthenticationError(refreshError)) {
            onAuthenticationRequired()
            return false
          }
        }
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'This finding could not be saved. Please try again.'),
      })
      return false
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, onAuthenticationRequired])

  const loadSlackHistoryChannels = useCallback(async (showLoading = true) => {
    slackHistoryRequestRef.current?.abort()
    const controller = new AbortController()
    slackHistoryRequestRef.current = controller
    if (showLoading) setSlackHistoryLoadState('loading')
    setNotice(null)
    try {
      const next = await fetchSlackHistoryChannels(controller.signal)
      if (controller.signal.aborted || slackHistoryRequestRef.current !== controller) return null
      setSlackHistoryChannels(next)
      setSlackHistoryLoadState('ready')
      if (next.status === 'ready' && !slackChannelSelectionInitializedRef.current) {
        slackChannelSelectionInitializedRef.current = true
        setSelectedSlackChannelIds(new Set(next.channels.map((channel) => channel.id)))
      }
      return next
    } catch (error) {
      if (controller.signal.aborted || slackHistoryRequestRef.current !== controller) return null
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return null
      }
      setSlackHistoryLoadState('error')
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'Slack channels could not be loaded. Please try again.'),
      })
      return null
    } finally {
      if (slackHistoryRequestRef.current === controller) slackHistoryRequestRef.current = null
    }
  }, [onAuthenticationRequired])

  const openSlackHistoryChannels = useCallback(() => {
    setSlackHistoryStep('channels')
    setSlackHistoryIncomplete(true)
    setSlackChannelSearch('')
    setSlackProvisioningPolls(0)
    void loadSlackHistoryChannels()
  }, [loadSlackHistoryChannels])

  useEffect(() => {
    if (
      slackHistoryStep !== 'channels'
      || slackHistoryLoadState !== 'ready'
      || slackHistoryChannels?.status !== 'provisioning'
    ) return

    let stopped = false
    let polling = false
    let attempts = slackProvisioningPolls
    const timer = window.setInterval(() => {
      if (stopped || polling || document.visibilityState === 'hidden') return
      if (attempts >= SLACK_PROVISIONING_POLL_LIMIT) {
        stopped = true
        window.clearInterval(timer)
        setSlackHistoryLoadState('error')
        setNotice({
          tone: 'error',
          message: 'Slack is taking longer than expected to finish setup. Retry channel discovery in a moment.',
        })
        return
      }
      attempts += 1
      setSlackProvisioningPolls(attempts)
      polling = true
      void loadSlackHistoryChannels(false).finally(() => {
        polling = false
      })
    }, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [
    loadSlackHistoryChannels,
    slackHistoryChannels?.status,
    slackHistoryLoadState,
    slackHistoryStep,
  ])

  const toggleSlackHistoryChannel = useCallback((channelId: string) => {
    setSelectedSlackChannelIds((current) => {
      const next = new Set(current)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }, [])

  const selectAllSlackHistoryChannels = useCallback((channels: SlackHistoryChannel[]) => {
    setSelectedSlackChannelIds(new Set(channels.map((channel) => channel.id)))
  }, [])

  const clearSlackHistoryChannels = useCallback(() => {
    setSelectedSlackChannelIds(new Set())
  }, [])

  const queueSlackHistory = useCallback(async () => {
    if (busyAction || selectedSlackChannelIds.size === 0) return
    const channelIds = [...selectedSlackChannelIds].sort()
    const windowDays = Math.min(SLACK_HISTORY_MAX_DAYS, Math.max(1, Math.round(slackHistoryWindowDays)))
    const signature = `${slackProactivityEnabled}\n${windowDays}\n${channelIds.join('\n')}`
    const needsEstimate = windowDays > SLACK_HISTORY_DIRECT_MAX_DAYS
    const attemptRef = needsEstimate ? slackEstimateAttemptRef : slackSyncAttemptRef
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = { signature, idempotencyKey: crypto.randomUUID() }
    }

    setBusyAction(needsEstimate ? 'slack-history-estimate' : 'slack-history-sync')
    setNotice(null)
    try {
      const result = needsEstimate
        ? await estimateSlackHistorySync(channelIds, windowDays, attemptRef.current.idempotencyKey)
        : await queueSlackHistorySync(
            channelIds,
            windowDays,
            attemptRef.current.idempotencyKey,
            slackProactivityEnabled,
          )
      const { run } = result
      attemptRef.current = null
      writeSlackHistorySkipped(organizationId, false)
      if (needsEstimate) {
        setSlackHistoryEstimateRun(run)
        setSlackHistoryEstimateChannelCount(channelIds.length)
        setSlackHistoryStep('estimate')
        setSlackHistoryIncomplete(true)
        writeSlackHistoryEstimate(organizationId, {
          run,
          channelCount: channelIds.length,
          proactivityEnabled: slackProactivityEnabled,
        })
        return
      }
      setSlackHistoryEstimateRun(null)
      setSlackHistoryEstimateChannelCount(0)
      writeSlackHistoryEstimate(organizationId, null)
      setSlackHistorySyncRun(run)
      setSlackHistoryQueuedChannelCount(channelIds.length)
      setSlackHistoryStep('mailbox')
      setSlackHistoryIncomplete(true)
      writeQueuedSlackHistorySync(organizationId, {
        run,
        channelCount: channelIds.length,
        proactivityEnabled: slackProactivityEnabled,
      })
      onSlackHistoryStarted?.()
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      if (error instanceof CompanyOnboardingHttpError && error.code === 'history_in_progress') {
        try {
          const current = await fetchCurrentSlackHistorySync()
          if (current) {
            const currentChannelCount = current.channelIds.length || channelIds.length
            slackSyncAttemptRef.current = null
            slackEstimateAttemptRef.current = null
            setSlackHistoryEstimateRun(null)
            setSlackHistoryEstimateChannelCount(0)
            writeSlackHistoryEstimate(organizationId, null)
            setSlackHistorySyncRun(current)
            setSlackHistoryQueuedChannelCount(currentChannelCount)
            setSlackHistoryStep('mailbox')
            setSlackHistoryIncomplete(true)
            writeSlackHistorySkipped(organizationId, false)
            writeQueuedSlackHistorySync(organizationId, {
              run: current,
              channelCount: currentChannelCount,
              proactivityEnabled: slackProactivityEnabled,
            })
            onSlackHistoryStarted?.()
            return
          }
        } catch (currentError) {
          if (isAuthenticationError(currentError)) {
            onAuthenticationRequired()
            return
          }
        }
      }
      if (error instanceof CompanyOnboardingHttpError && error.status < 500) {
        attemptRef.current = null
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(
          error,
          needsEstimate
            ? 'Slack messages could not be counted. Please try again.'
            : 'Slack history could not be queued. Please try again.',
        ),
      })
    } finally {
      setBusyAction(null)
    }
  }, [
    busyAction,
    onAuthenticationRequired,
    onSlackHistoryStarted,
    organizationId,
    selectedSlackChannelIds,
    slackProactivityEnabled,
    slackHistoryWindowDays,
  ])

  useEffect(() => {
    const run = slackHistoryEstimateRun
    if (
      slackHistoryStep !== 'estimate'
      || !run
      || run.phase === 'awaiting_confirmation'
      || run.phase === 'failed'
      || run.status === 'failed'
    ) return undefined

    let stopped = false
    let timer: number | undefined
    let controller: AbortController | null = null
    const poll = async () => {
      if (stopped || document.visibilityState === 'hidden') {
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
        return
      }
      controller = new AbortController()
      try {
        const next = await fetchSlackHistorySyncRun(run.id, controller.signal)
        if (stopped || controller.signal.aborted) return
        setSlackHistoryEstimateRun(next)
        writeSlackHistoryEstimate(organizationId, {
          run: next,
          channelCount: slackHistoryEstimateChannelCount,
          proactivityEnabled: slackProactivityEnabled,
        })
        if (next.phase === 'awaiting_confirmation' || next.phase === 'failed' || next.status === 'failed') return
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
      } catch (error) {
        if (stopped || controller.signal.aborted) return
        if (isAuthenticationError(error)) {
          onAuthenticationRequired()
          return
        }
        const retryAfter = error instanceof CompanyOnboardingHttpError
          ? error.retryAfterMs ?? POLL_INTERVAL_MS
          : POLL_INTERVAL_MS
        timer = window.setTimeout(() => void poll(), Math.max(POLL_INTERVAL_MS, retryAfter))
      }
    }
    void poll()
    return () => {
      stopped = true
      controller?.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    onAuthenticationRequired,
    organizationId,
    slackHistoryEstimateChannelCount,
    slackHistoryEstimateRun?.id,
    slackHistoryEstimateRun?.phase,
    slackHistoryEstimateRun?.status,
    slackHistoryStep,
    slackProactivityEnabled,
  ])

  const startEstimatedSlackHistory = useCallback(async () => {
    const estimate = slackHistoryEstimateRun
    if (!estimate || estimate.phase !== 'awaiting_confirmation' || busyAction) return
    if (slackEstimateStartAttemptRef.current?.runId !== estimate.id) {
      slackEstimateStartAttemptRef.current = {
        runId: estimate.id,
        idempotencyKey: crypto.randomUUID(),
      }
    }
    setBusyAction('slack-history-start')
    setNotice(null)
    try {
      const { run } = await startEstimatedSlackHistorySync(
        estimate.id,
        slackEstimateStartAttemptRef.current.idempotencyKey,
        slackProactivityEnabled,
      )
      slackEstimateStartAttemptRef.current = null
      setSlackHistoryEstimateRun(null)
      setSlackHistoryEstimateChannelCount(0)
      writeSlackHistoryEstimate(organizationId, null)
      writeSlackHistorySkipped(organizationId, false)
      setSlackHistorySyncRun(run)
      setSlackHistoryQueuedChannelCount(estimate.channelIds.length || slackHistoryEstimateChannelCount)
      writeQueuedSlackHistorySync(organizationId, {
        run,
        channelCount: estimate.channelIds.length || slackHistoryEstimateChannelCount,
        proactivityEnabled: slackProactivityEnabled,
      })
      setSlackHistoryStep('mailbox')
      setSlackHistoryIncomplete(true)
      onSlackHistoryStarted?.()
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      if (error instanceof CompanyOnboardingHttpError && error.status < 500) {
        slackEstimateStartAttemptRef.current = null
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'Slack history sync could not be started. Please try again.'),
      })
    } finally {
      setBusyAction(null)
    }
  }, [
    busyAction,
    onAuthenticationRequired,
    onSlackHistoryStarted,
    organizationId,
    slackHistoryEstimateChannelCount,
    slackHistoryEstimateRun,
    slackProactivityEnabled,
  ])

  const loadMailboxSlackChannels = useCallback(async () => {
    const requestOrganizationId = organizationId
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return null
    if (
      mailboxSlackChannelsRetryAtRef.current !== null
      && Date.now() < mailboxSlackChannelsRetryAtRef.current
    ) return null
    mailboxSlackChannelsRetryAtRef.current = null
    setMailboxSlackChannelsRetryAt(null)
    mailboxSlackChannelsRequestRef.current?.abort()
    const controller = new AbortController()
    mailboxSlackChannelsRequestRef.current = controller
    setMailboxSlackChannels(null)
    setMailboxSlackChannelsLoadState('loading')
    try {
      const next = await fetchCompanyMailboxSlackChannels(requestOrganizationId, controller.signal)
      if (
        controller.signal.aborted
        || mailboxSlackChannelsRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      mailboxSlackChannelsRetryAtRef.current = null
      setMailboxSlackChannelsRetryAt(null)
      setMailboxSlackChannels(next)
      setMailboxSlackChannelsLoadState('ready')
      return next
    } catch (error) {
      if (
        controller.signal.aborted
        || mailboxSlackChannelsRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      if (isMailboxAuthenticationError(error)) {
        onAuthenticationRequired()
        return null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        const retryAt = Date.now() + error.retryAfterMs
        mailboxSlackChannelsRetryAtRef.current = retryAt
        setMailboxSlackChannelsRetryAt(retryAt)
      } else {
        mailboxSlackChannelsRetryAtRef.current = null
        setMailboxSlackChannelsRetryAt(null)
      }
      setMailboxSlackChannels(null)
      setMailboxSlackChannelsLoadState('error')
      return null
    } finally {
      if (mailboxSlackChannelsRequestRef.current === controller) {
        if (currentOrganizationScopeRef.current === requestScope) {
          mailboxSlackChannelsRequestRef.current = null
        }
      }
    }
  }, [onAuthenticationRequired, organizationId])

  const loadMailboxSummary = useCallback(async (showLoading = true, advanceWhenReady = true) => {
    const requestOrganizationId = organizationId
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return null
    if (mailboxRequestRef.current) return null
    if (mailboxRetryAtRef.current !== null && Date.now() < mailboxRetryAtRef.current) return null
    const controller = new AbortController()
    mailboxRequestRef.current = controller
    if (showLoading) setMailboxLoadState('loading')
    setNotice(null)
    try {
      const next = await fetchCompanyMailboxSummary(requestOrganizationId, controller.signal)
      if (
        controller.signal.aborted
        || mailboxRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      mailboxRetryAtRef.current = null
      setMailboxSummary(next)
      if (!mailboxSlackDeliveryDraftInitializedRef.current) {
        mailboxSlackDeliveryDraftInitializedRef.current = true
        setMailboxSlackDeliveryEnabled(next.slackDelivery.enabled)
        setMailboxSlackDeliveryChannelId(next.slackDelivery.channelId ?? '')
      }
      setMailboxLoadState('ready')
      setMailboxIncomplete(next.status === 'skipped')
      if (
        next.status === 'ready'
        && advanceWhenReady
        && mailboxCreateAttemptRef.current === null
      ) setSlackHistoryStep('queued')
      return next
    } catch (error) {
      if (
        controller.signal.aborted
        || mailboxRequestRef.current !== controller
        || currentOrganizationScopeRef.current !== requestScope
      ) return null
      if (isMailboxAuthenticationError(error)) {
        onAuthenticationRequired()
        return null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        mailboxRetryAtRef.current = Date.now() + error.retryAfterMs
      } else {
        mailboxRetryAtRef.current = null
      }
      setMailboxLoadState('error')
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'Company email could not be loaded. Please try again.'),
      })
      return null
    } finally {
      if (
        currentOrganizationScopeRef.current === requestScope
        && mailboxRequestRef.current === controller
      ) mailboxRequestRef.current = null
    }
  }, [onAuthenticationRequired, organizationId])

  useEffect(() => {
    if (slackHistoryStep !== 'mailbox') return
    if (mailboxCreateAttemptRef.current === null) {
      mailboxSlackDeliveryDraftInitializedRef.current = false
      setMailboxSlackDeliveryEnabled(false)
      setMailboxSlackDeliveryChannelId('')
    }
    void Promise.all([loadMailboxSummary(), loadMailboxSlackChannels()])
    return () => {
      const summaryRequest = mailboxRequestRef.current
      mailboxRequestRef.current = null
      summaryRequest?.abort()
      const channelsRequest = mailboxSlackChannelsRequestRef.current
      mailboxSlackChannelsRequestRef.current = null
      channelsRequest?.abort()
    }
  }, [loadMailboxSlackChannels, loadMailboxSummary, reopenToken, slackHistoryStep])

  useEffect(() => {
    if (
      !mailboxSummary
      || mailboxSlackChannelsLoadState !== 'ready'
      || mailboxSlackChannels?.status !== 'ready'
      || !mailboxSlackDeliveryChannelId
    ) return
    const listed = mailboxSlackChannels.channels.some(
      (channel) => channel.id === mailboxSlackDeliveryChannelId,
    )
    const savedForCurrentTeam = Boolean(
      mailboxSummary.slackDelivery.channelId === mailboxSlackDeliveryChannelId
      && mailboxSummary.slackDelivery.teamId
      && mailboxSummary.slackDelivery.teamId === mailboxSlackChannels.teamId,
    )
    if (listed || savedForCurrentTeam) return
    if (mailboxCreateAttemptRef.current !== null) return
    setMailboxSlackDeliveryChannelId('')
    mailboxCreateAttemptRef.current = null
  }, [
    mailboxSlackChannels,
    mailboxSlackChannelsLoadState,
    mailboxSlackDeliveryChannelId,
    mailboxSummary,
  ])

  useEffect(() => {
    if (
      slackHistoryStep !== 'mailbox'
      || (mailboxSummary?.status !== 'provisioning' && mailboxRetryAtRef.current === null)
    ) return undefined
    let stopped = false
    let timer: number | undefined
    const poll = () => {
      const retryAt = mailboxRetryAtRef.current
      timer = window.setTimeout(async () => {
        const next = await loadMailboxSummary(false)
        if (!stopped && next?.status === 'ready' && mailboxCreateAttemptRef.current !== null) {
          const expectedTeamId = mailboxSlackChannels?.status === 'ready'
            ? mailboxSlackChannels.teamId
            : null
          const slackDeliveryRecovered = !mailboxSlackDeliveryEnabled || (
            next.slackDelivery.enabled
            && next.slackDelivery.teamId === expectedTeamId
            && next.slackDelivery.channelId === mailboxSlackDeliveryChannelId
          )
          if (slackDeliveryRecovered) {
            mailboxCreateAttemptRef.current = null
            setMailboxActionRetryAt(null)
            setMailboxIncomplete(false)
            setSlackHistoryStep('queued')
            setNotice({ tone: 'info', message: 'Company email is ready.' })
          } else {
            setNotice({
              tone: 'info',
              message: 'Company email is ready. Retry the remaining setup when the button is available, or skip and finish it later in Brain settings.',
            })
          }
        }
        if (!stopped && (next?.status === 'provisioning' || mailboxRetryAtRef.current !== null)) poll()
      }, retryAt === null ? 2_500 : Math.max(0, retryAt - Date.now()))
    }
    poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    loadMailboxSummary,
    mailboxLoadState,
    mailboxSlackChannels,
    mailboxSlackDeliveryChannelId,
    mailboxSlackDeliveryEnabled,
    mailboxSummary?.status,
    slackHistoryStep,
  ])

  const handleMailboxSlackDeliveryEnabledChange = useCallback((enabled: boolean) => {
    setMailboxSlackDeliveryEnabled(enabled)
    mailboxCreateAttemptRef.current = null
    setNotice(null)
  }, [])

  const handleMailboxSlackDeliveryChannelChange = useCallback((channelId: string) => {
    setMailboxSlackDeliveryChannelId(channelId)
    mailboxCreateAttemptRef.current = null
    setNotice(null)
  }, [])

  const retryMailboxSlackChannels = useCallback(() => {
    void loadMailboxSlackChannels()
  }, [loadMailboxSlackChannels])

  const mailboxSlackTeamId = mailboxSlackChannels?.status === 'ready'
    ? mailboxSlackChannels.teamId
    : null
  const mailboxSelectedSlackChannel = mailboxSlackChannels?.channels.find(
    (channel) => channel.id === mailboxSlackDeliveryChannelId,
  )
  const mailboxSlackDeliveryChannelValid = Boolean(
    mailboxSlackTeamId && mailboxSelectedSlackChannel,
  )
  const mailboxActionRetrySeconds = mailboxActionRetryAt === null
    ? 0
    : Math.max(0, Math.ceil((mailboxActionRetryAt - mailboxActionNow) / 1_000))
  const mailboxCreateRequestPending = mailboxCreateAttemptRef.current !== null

  const createOnboardingMailbox = useCallback(async () => {
    const requestOrganizationId = organizationId
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return
    if (mailboxActionRetryAt !== null && Date.now() < mailboxActionRetryAt) return
    const normalizedLocalPart = mailboxLocalPart.trim().toLowerCase()
    const normalizedDisplayName = mailboxDisplayName.trim() || `${initialOrganizationName || 'Company'} Company Brain`
    const slackTeamId = mailboxSlackTeamId
    if (busyAction || !MAILBOX_LOCAL_PART.test(normalizedLocalPart)) {
      if (!MAILBOX_LOCAL_PART.test(normalizedLocalPart)) {
        setNotice({ tone: 'error', message: 'Use lowercase letters, numbers, dots, dashes, or underscores for the email name.' })
      }
      return
    }
    if (mailboxSlackDeliveryEnabled && !mailboxSlackDeliveryChannelValid) {
      setNotice({ tone: 'error', message: 'Choose one public Slack channel, or turn Slack delivery off.' })
      return
    }
    const signature = [
      normalizedLocalPart,
      normalizedDisplayName,
      mailboxSlackDeliveryEnabled ? 'slack:on' : 'slack:off',
      mailboxSlackDeliveryEnabled ? slackTeamId : '',
      mailboxSlackDeliveryEnabled ? mailboxSlackDeliveryChannelId : '',
    ].join('\n')
    if (mailboxCreateAttemptRef.current?.signature !== signature) {
      mailboxCreateAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() }
    }
    setBusyAction('company-mailbox-create')
    setNotice(null)
    try {
      const result = await createCompanyMailbox(requestOrganizationId, {
        localPart: normalizedLocalPart,
        displayName: normalizedDisplayName,
        ...(mailboxSlackDeliveryEnabled && slackTeamId ? {
          slackDelivery: {
            enabled: true as const,
            teamId: slackTeamId,
            channelId: mailboxSlackDeliveryChannelId,
          },
        } : {}),
      }, mailboxCreateAttemptRef.current.idempotencyKey)
      if (currentOrganizationScopeRef.current !== requestScope) return
      mailboxCreateAttemptRef.current = null
      setMailboxSummary(result.summary)
      setMailboxSlackDeliveryEnabled(result.summary.slackDelivery.enabled)
      setMailboxSlackDeliveryChannelId(result.summary.slackDelivery.channelId ?? '')
      setMailboxActionRetryAt(null)
      setMailboxIncomplete(false)
      setSlackHistoryStep('queued')
    } catch (error) {
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (isMailboxAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      if (error instanceof CompanyMailboxHttpError && error.status < 500 && error.status !== 429) {
        mailboxCreateAttemptRef.current = null
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        const retryAt = Date.now() + error.retryAfterMs
        setMailboxActionNow(Date.now())
        setMailboxActionRetryAt(retryAt)
      }
      const recoveredSummary = await loadMailboxSummary(false, false)
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (recoveredSummary?.status === 'ready') {
        const slackDeliveryRecovered = !mailboxSlackDeliveryEnabled || (
          recoveredSummary.slackDelivery.enabled
          && recoveredSummary.slackDelivery.teamId === mailboxSlackTeamId
          && recoveredSummary.slackDelivery.channelId === mailboxSlackDeliveryChannelId
        )
        if (slackDeliveryRecovered) {
          mailboxCreateAttemptRef.current = null
          setMailboxActionRetryAt(null)
          setSlackHistoryStep('queued')
        }
        setNotice({
          tone: 'info',
          message: slackDeliveryRecovered
            ? 'Company email is ready.'
            : 'Company email is ready. Retry Slack delivery when the button is available, or skip and finish it later in Brain settings.',
        })
        return
      }
      if (recoveredSummary?.status === 'provisioning') {
        setNotice({ tone: 'info', message: 'Company email setup is still finishing.' })
        return
      }
      setNotice({ tone: 'error', message: userFacingErrorMessage(error, 'The company email could not be created.') })
    } finally {
      if (currentOrganizationScopeRef.current === requestScope) setBusyAction(null)
    }
  }, [
    busyAction,
    initialOrganizationName,
    mailboxDisplayName,
    mailboxLocalPart,
    mailboxActionRetryAt,
    mailboxSlackChannels,
    mailboxSlackDeliveryChannelId,
    mailboxSlackDeliveryChannelValid,
    mailboxSlackDeliveryEnabled,
    mailboxSlackTeamId,
    loadMailboxSummary,
    onAuthenticationRequired,
    organizationId,
  ])

  const skipOnboardingMailbox = useCallback(async () => {
    const requestOrganizationId = organizationId
    const requestScope = currentOrganizationScopeRef.current
    if (requestScope.organizationId !== requestOrganizationId) return
    if (busyAction) return
    if (mailboxSummary?.status === 'ready') {
      mailboxCreateAttemptRef.current = null
      setMailboxActionRetryAt(null)
      setMailboxIncomplete(false)
      setSlackHistoryStep('queued')
      setNotice({
        tone: 'info',
        message: 'Company email is ready. Slack delivery can be completed later from Brain settings.',
      })
      return
    }
    setBusyAction('company-mailbox-skip')
    setNotice(null)
    try {
      const result = await skipCompanyMailbox(requestOrganizationId)
      if (currentOrganizationScopeRef.current !== requestScope) return
      setMailboxSummary(result.summary)
      setMailboxIncomplete(true)
      setSlackHistoryStep('queued')
      onIncompleteChange(true)
    } catch (error) {
      if (currentOrganizationScopeRef.current !== requestScope) return
      if (isMailboxAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice({ tone: 'error', message: userFacingErrorMessage(error, 'Company email could not be skipped. Please try again.') })
    } finally {
      if (currentOrganizationScopeRef.current === requestScope) setBusyAction(null)
    }
  }, [busyAction, mailboxSummary?.status, onAuthenticationRequired, onIncompleteChange, organizationId])

  useEffect(() => {
    mailboxSkipRef.current = () => void skipOnboardingMailbox()
  }, [skipOnboardingMailbox])

  const finishSlackHistory = useCallback(async () => {
    if (!snapshot || busyAction) return
    const run = snapshot.run
    const researchIsStillActive = run?.status === 'queued' || run?.status === 'running'
    const slackWasSkipped = readSlackHistorySkipped(organizationId)
    const mailboxWasSkipped = mailboxSummary?.status === 'skipped'
    const optionalSetupIncomplete = slackWasSkipped || mailboxWasSkipped
    if (!run && snapshot.status === 'completed') {
      setSlackHistoryStep('idle')
      setSlackHistoryIncomplete(slackWasSkipped)
      setMailboxIncomplete(mailboxWasSkipped)
      setDismissed(true)
      onOpenChange(false)
      setNotice(null)
      writeQueuedSlackHistorySync(organizationId, null)
      onIncompleteChange(optionalSetupIncomplete)
      return
    }
    if (researchIsStillActive || !run) {
      setSlackHistoryStep('idle')
      setDismissed(true)
      onOpenChange(false)
      setSlackHistoryIncomplete(true)
      setNotice(null)
      onIncompleteChange(true)
      return
    }

    setBusyAction('complete')
    setNotice(null)
    try {
      const next = await completeCompanyOnboarding(run.id)
      setSnapshot(next)
      setSlackHistoryStep('idle')
      setSlackHistoryIncomplete(slackWasSkipped)
      setMailboxIncomplete(mailboxWasSkipped)
      writeQueuedSlackHistorySync(organizationId, null)
      onIncompleteChange(optionalSetupIncomplete)
      await onCompleted()
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'Onboarding could not be completed.'),
      })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, mailboxSummary?.status, onAuthenticationRequired, onCompleted, onIncompleteChange, onOpenChange, organizationId, snapshot])

  const connectSlack = useCallback(async () => {
    if (!snapshot || snapshot.slackConnected) return
    setBusyAction('slack')
    setNotice(null)
    try {
      let path = snapshot.slackConnectPath
      if (!path) {
        const integrations = await fetchBrainIntegrations()
        const slack = integrations.find((integration) => integration.slug === 'slack')
        path = slack?.actions.connect.path ?? undefined
      }
      if (!path) throw new Error('Slack setup is not available for this organization yet.')
      const redirectUrl = new URL('/dashboard?onboarding=slack', window.location.origin).toString()
      const result = await connectBrainIntegration(path, {
        scope: 'organization',
        redirect_url: redirectUrl,
      })
      if (result.type !== 'oauth') throw new Error('Invalid Slack setup response.')
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: integrationErrorMessage(error, 'Slack setup could not be opened.'),
      })
      setBusyAction(null)
    }
  }, [onAuthenticationRequired, snapshot])

  const finish = useCallback(async () => {
    const runId = snapshot?.run?.id
    if (!runId) {
      setNotice({ tone: 'error', message: 'The research run could not be identified. Refresh and try again.' })
      return
    }
    setBusyAction('complete')
    setNotice(null)
    try {
      const next = await completeCompanyOnboarding(runId)
      setSnapshot(next)
      await onCompleted()
    } catch (error) {
      if (isAuthenticationError(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: onboardingErrorMessage(error, 'Onboarding could not be completed.'),
      })
    } finally {
      setBusyAction(null)
    }
  }, [onAuthenticationRequired, onCompleted, snapshot?.run?.id])

  const openDashboardSection = useCallback((open: () => void) => {
    setDismissed(true)
    onOpenChange(false)
    open()
  }, [onOpenChange])

  if (!visible || !snapshot) return null

  const run = snapshot.run
  const organizationName = snapshot.organizationName || initialOrganizationName || 'your company'

  return createPortal(
    <div className="brain-onboarding-backdrop">
      <div
        ref={dialogRef}
        className={`brain-onboarding${notice ? ' brain-onboarding--with-notice' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brain-onboarding-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="brain-onboarding__topbar">
          <a
            className="brain-onboarding__brand"
            href="/"
            aria-label="MemCode home"
            onClick={(event) => {
              if (editingResearchCardKey === null) return
              event.preventDefault()
              showResearchEditLockNotice()
            }}
          >
            <span aria-hidden="true"><img src="/logo.jpeg" alt="" /></span>
            <strong>memCode</strong>
          </a>
          <div className="brain-onboarding__status">
            <span>{slackHistoryActive
              ? slackHistoryStep === 'connected'
                ? 'Slack connected'
                : slackHistoryStep === 'channels'
                  ? 'Choose Slack history'
                  : slackHistoryStep === 'estimate'
                    ? 'Review Slack estimate'
                  : slackHistoryStep === 'mailbox'
                    ? 'Company email'
                    : 'Finish setup'
              : correctingDomain
                ? 'Correct company website'
                : run
                  ? `Researching ${run.domain}`
                  : 'Company setup'}</span>
            <i aria-hidden="true" />
          </div>
          <button
            type="button"
            className="brain-onboarding__later"
            disabled={editingResearchCardKey !== null || (slackHistoryActive && busyAction !== null)}
            onClick={() => {
              if (slackHistoryStep === 'mailbox') void skipOnboardingMailbox()
              else if (
                slackHistoryStep === 'connected'
                || slackHistoryStep === 'channels'
                || slackHistoryStep === 'estimate'
              ) skipSlackHistory()
              else dismiss()
            }}
          >
            {editingResearchCardKey !== null
              ? 'Save or cancel edit'
              : slackHistoryActive
                ? 'Skip for now'
                : 'Continue to dashboard'}
          </button>
        </header>

        {notice ? (
          <div
            className={`brain-onboarding__notice brain-onboarding__notice--${notice.tone}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            {notice.message}
          </div>
        ) : null}

        {slackHistoryStep === 'connected' ? (
          <SlackConnectedStep
            organizationName={organizationName}
            busy={slackHistoryLoadState === 'loading'}
            onContinue={openSlackHistoryChannels}
          />
        ) : slackHistoryStep === 'channels' ? (
          <SlackHistoryChannelsStep
            channels={slackHistoryChannels}
            loadState={slackHistoryLoadState}
            visibleChannels={visibleSlackHistoryChannels}
            selectedChannelIds={selectedSlackChannelIds}
            search={slackChannelSearch}
            windowDays={slackHistoryWindowDays}
            proactivityEnabled={slackProactivityEnabled}
            busy={busyAction === 'slack-history-sync' || busyAction === 'slack-history-estimate'}
            onSearchChange={setSlackChannelSearch}
            onWindowDaysChange={(value) => {
              setSlackHistoryWindowDays(value)
              slackSyncAttemptRef.current = null
              slackEstimateAttemptRef.current = null
              setNotice(null)
            }}
            onToggleChannel={toggleSlackHistoryChannel}
            onProactivityEnabledChange={(enabled) => {
              setSlackProactivityEnabled(enabled)
              slackSyncAttemptRef.current = null
              slackEstimateStartAttemptRef.current = null
              setNotice(null)
            }}
            onSelectAll={selectAllSlackHistoryChannels}
            onClearAll={clearSlackHistoryChannels}
            onRetry={() => {
              setSlackProvisioningPolls(0)
              void loadSlackHistoryChannels()
            }}
            onQueue={() => void queueSlackHistory()}
          />
        ) : slackHistoryStep === 'estimate' ? (
          <SlackHistoryEstimateStep
            run={slackHistoryEstimateRun}
            channelCount={slackHistoryEstimateChannelCount}
            busy={busyAction === 'slack-history-start'}
            onBack={() => {
              if (slackHistoryEstimateRun?.channelIds.length) {
                setSelectedSlackChannelIds(new Set(slackHistoryEstimateRun.channelIds))
              }
              writeSlackHistoryEstimate(organizationId, null)
              setSlackHistoryEstimateRun(null)
              setSlackHistoryEstimateChannelCount(0)
              slackEstimateAttemptRef.current = null
              setSlackHistoryStep('channels')
              setNotice(null)
            }}
            onStart={() => void startEstimatedSlackHistory()}
          />
        ) : slackHistoryStep === 'mailbox' ? (
          <CompanyMailboxOnboardingStep
            summary={mailboxSummary}
            loadState={mailboxLoadState}
            localPart={mailboxLocalPart}
            displayName={mailboxDisplayName}
            organizationName={organizationName}
            slackChannels={mailboxSlackChannels}
            slackChannelsLoadState={mailboxSlackChannelsLoadState}
            slackChannelsRetryAt={mailboxSlackChannelsRetryAt}
            slackDeliveryEnabled={mailboxSlackDeliveryEnabled}
            slackDeliveryChannelId={mailboxSlackDeliveryChannelId}
            slackDeliveryChannelValid={mailboxSlackDeliveryChannelValid}
            retrySeconds={mailboxActionRetrySeconds}
            createRequestPending={mailboxCreateRequestPending}
            busy={busyAction === 'company-mailbox-create' || busyAction === 'company-mailbox-skip'}
            onLocalPartChange={(value) => {
              setMailboxLocalPart(value.toLowerCase())
              mailboxCreateAttemptRef.current = null
              setNotice(null)
            }}
            onDisplayNameChange={(value) => {
              setMailboxDisplayName(value)
              mailboxCreateAttemptRef.current = null
              setNotice(null)
            }}
            onSlackDeliveryEnabledChange={handleMailboxSlackDeliveryEnabledChange}
            onSlackDeliveryChannelChange={handleMailboxSlackDeliveryChannelChange}
            onRetrySlackChannels={retryMailboxSlackChannels}
            onCreate={() => void createOnboardingMailbox()}
            onRetry={() => void loadMailboxSummary()}
          />
        ) : slackHistoryStep === 'queued' ? (
          <SlackHistoryQueuedStep
            run={slackHistorySyncRun}
            channelCount={slackHistoryQueuedChannelCount}
            slackSkipped={readSlackHistorySkipped(organizationId)}
            mailboxSummary={mailboxSummary}
            researchActive={researchIsActive}
            busy={busyAction === 'complete'}
            onFinish={() => void finishSlackHistory()}
          />
        ) : correctingDomain ? (
          <DomainStep
            initialDomain={run?.domain || snapshot.primaryDomain || initialDomain || ''}
            busy={busyAction === 'research'}
            researchAvailable={snapshot.researchAvailable}
            onSubmit={runResearch}
          />
        ) : !run || snapshot.status === 'not_started' ? (
          <DomainStep
            initialDomain={snapshot.primaryDomain || initialDomain || ''}
            busy={busyAction === 'research'}
            researchAvailable={snapshot.researchAvailable}
            onSubmit={runResearch}
          />
        ) : run.status === 'queued' || run.status === 'running' ? (
          <ResearchWorkspace
            run={run}
            organizationName={organizationName}
            slackConnected={snapshot.slackConnected}
            busyAction={busyAction}
            onConnectSlack={connectSlack}
            onOpenAccount={() => openDashboardSection(onOpenAccount)}
            onOpenConnectors={() => openDashboardSection(onOpenConnectors)}
          />
        ) : (
          <ResearchReview
            run={run}
            organizationName={organizationName}
            activeCard={activeCard}
            researchAttempts={snapshot.researchAttempts}
            researchAttemptLimit={snapshot.researchAttemptLimit}
            slackConnected={snapshot.slackConnected}
            busyAction={busyAction}
            editingCardKey={editingResearchCardKey}
            onActiveCardChange={setActiveCard}
            onEditingCardChange={handleResearchCardEditingChange}
            onConnectSlack={connectSlack}
            onChangeWebsite={() => {
              setNotice(null)
              setCorrectingDomain(true)
            }}
            onRetry={() => void runResearch(run.domain)}
            onUpdateCard={updateResearchCard}
            onFinish={finish}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

function SlackConnectedStep({
  organizationName,
  busy,
  onContinue,
}: {
  organizationName: string
  busy: boolean
  onContinue: () => void
}) {
  return (
    <main className="brain-onboarding-slack brain-onboarding-slack--connected">
      <section className="brain-onboarding-slack__hero" aria-labelledby="brain-onboarding-title">
        <div className="brain-onboarding-slack__success-mark" aria-hidden="true">
          <SlackMark />
          <span><CheckIcon /></span>
        </div>
        <span className="brain-onboarding-slack__eyebrow">Connection complete</span>
        <h1 id="brain-onboarding-title" tabIndex={-1}>Slack was successfully added.</h1>
        <p>
          {organizationName} can now bring recent public-channel context into company memory. You choose exactly
          which channels are included before anything is queued.
        </p>
        <div className="brain-onboarding-slack__privacy-note">
          <strong>Next: choose public channels</strong>
          <span>Choose anywhere from 1 to 365 days. Private channels and direct messages stay out.</span>
        </div>
        <button type="button" className="brain-onboarding-slack__primary" disabled={busy} onClick={onContinue}>
          {busy ? 'Loading channels…' : 'Continue'} <ArrowRightIcon />
        </button>
      </section>
    </main>
  )
}

function SlackHistoryChannelsStep({
  channels,
  loadState,
  visibleChannels,
  selectedChannelIds,
  search,
  windowDays,
  proactivityEnabled,
  busy,
  onSearchChange,
  onWindowDaysChange,
  onToggleChannel,
  onProactivityEnabledChange,
  onSelectAll,
  onClearAll,
  onRetry,
  onQueue,
}: {
  channels: SlackHistoryChannels | null
  loadState: SlackHistoryLoadState
  visibleChannels: SlackHistoryChannel[]
  selectedChannelIds: Set<string>
  search: string
  windowDays: number
  proactivityEnabled: boolean
  busy: boolean
  onSearchChange: (value: string) => void
  onWindowDaysChange: (value: number) => void
  onToggleChannel: (channelId: string) => void
  onProactivityEnabledChange: (enabled: boolean) => void
  onSelectAll: (channels: SlackHistoryChannel[]) => void
  onClearAll: () => void
  onRetry: () => void
  onQueue: () => void
}) {
  const ready = loadState === 'ready' && channels?.status === 'ready'
  const loading = loadState === 'loading' || channels?.status === 'provisioning'
  const extendedWindow = windowDays > SLACK_HISTORY_DIRECT_MAX_DAYS

  return (
    <main className="brain-onboarding-slack brain-onboarding-slack--channels">
      <section className="brain-onboarding-slack__channels" aria-labelledby="brain-onboarding-title">
        <header className="brain-onboarding-slack__channels-heading">
          <div>
            <span className="brain-onboarding-slack__eyebrow">Public Slack history</span>
            <h1 id="brain-onboarding-title" tabIndex={-1}>Choose what Slack remembers.</h1>
            <p>Select the public channels and how far back company memory should go.</p>
          </div>
          <div className="brain-onboarding-slack__window" aria-label="Selected Slack history window">
            <strong>{windowDays} days</strong>
            <span>{extendedWindow ? 'Extended sync' : 'Starts immediately'}</span>
          </div>
        </header>

        <fieldset className="brain-onboarding-slack__range" disabled={busy}>
          <legend>How much history should we sync?</legend>
          <div className="brain-onboarding-slack__range-presets">
            {[7, 14, 30, 60, 90].map((days) => (
              <button
                key={days}
                type="button"
                className={windowDays === days ? 'is-selected' : ''}
                aria-pressed={windowDays === days}
                onClick={() => onWindowDaysChange(days)}
              >
                {days === 60 ? '2 months' : days === 90 ? '3 months' : `${days} days`}
              </button>
            ))}
            <label>
              <span>Custom</span>
              <input
                type="number"
                min={1}
                max={SLACK_HISTORY_MAX_DAYS}
                step={1}
                value={windowDays}
                aria-label="Custom Slack history days"
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value)) {
                    onWindowDaysChange(Math.min(SLACK_HISTORY_MAX_DAYS, Math.max(1, Math.round(value))))
                  }
                }}
              />
              <i>days</i>
            </label>
          </div>
          {extendedWindow ? (
            <p>
              First we’ll count the eligible messages and show the time and cost estimate. Nothing is added to
              memory until you review it and press Start.
            </p>
          ) : (
            <p>Up to 14 days starts in the background as soon as you continue.</p>
          )}
        </fieldset>

        {loading ? (
          <div className="brain-onboarding-slack__state" role="status" aria-live="polite">
            <span className="brain-onboarding-slack__spinner" aria-hidden="true" />
            <strong>{channels?.status === 'provisioning' ? 'Finishing Slack setup' : 'Loading public channels'}</strong>
            <p>{channels?.status === 'provisioning'
              ? 'Slack is connected. We’re waiting for the workspace channel list to become available.'
              : 'Reading the eligible public-channel list from your connected workspace.'}</p>
          </div>
        ) : loadState === 'error' ? (
          <SlackHistoryChannelsState
            title="Channels could not be loaded"
            detail="Retry channel discovery. Nothing has been queued yet."
            onRetry={onRetry}
          />
        ) : channels?.status === 'not_connected' ? (
          <SlackHistoryChannelsState
            title="Slack is still being connected"
            detail="The OAuth callback completed, but this workspace is not ready for history sync yet. Retry in a moment."
            onRetry={onRetry}
          />
        ) : ready ? (
          <>
            <div className="brain-onboarding-slack__channel-tools">
              <label>
                <span className="sr-only">Search public Slack channels</span>
                <SearchIcon />
                <input
                  type="search"
                  value={search}
                  placeholder="Search channels"
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </label>
              <span>{selectedChannelIds.size} of {channels.channels.length} selected</span>
              <button type="button" onClick={() => onSelectAll(channels.channels)}>Select all</button>
              <button type="button" onClick={onClearAll}>Clear</button>
            </div>

            <fieldset className="brain-onboarding-slack__channel-list" disabled={busy}>
              <legend className="sr-only">Public Slack channels to sync</legend>
              {visibleChannels.length ? visibleChannels.map((channel) => {
                const detail = channel.topic || channel.purpose
                return (
                  <label key={channel.id} className={selectedChannelIds.has(channel.id) ? 'is-selected' : ''}>
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.has(channel.id)}
                      onChange={() => onToggleChannel(channel.id)}
                    />
                    <span className="brain-onboarding-slack__channel-check" aria-hidden="true"><CheckIcon /></span>
                    <span className="brain-onboarding-slack__channel-name"># {channel.name}</span>
                    <span className="brain-onboarding-slack__channel-detail">
                      {detail || 'Public channel'}{channel.isMember === true ? ' · App is a member' : ''}
                    </span>
                  </label>
                )
              }) : (
                <div className="brain-onboarding-slack__channel-empty" role="status">
                  <strong>{channels.channels.length ? 'No channels match this search.' : 'No eligible public channels were returned.'}</strong>
                  <span>{channels.channels.length
                    ? 'Try another channel name or clear the search.'
                    : 'Add Memcode to a public channel in Slack, then retry channel discovery.'}</span>
                </div>
              )}
            </fieldset>

            <label className="brain-onboarding-slack__proactivity">
              <span>
                <strong>Let Memcode participate proactively</strong>
                <small>
                  In these selected channels, Memcode may answer useful messages even when it is not tagged.
                  This enables Slack participation only, not automatic research.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={proactivityEnabled}
                disabled={busy}
                onChange={(event) => onProactivityEnabledChange(event.target.checked)}
              />
            </label>

            <footer className="brain-onboarding-slack__channel-footer">
              <div>
                <strong>{selectedChannelIds.size} {selectedChannelIds.size === 1 ? 'channel' : 'channels'} selected</strong>
                <span>Only public conversations from the last {windowDays} days are included.</span>
              </div>
              <button
                type="button"
                className="brain-onboarding-slack__primary"
                disabled={busy || selectedChannelIds.size === 0}
                onClick={onQueue}
              >
                {busy
                  ? extendedWindow ? 'Counting messages…' : 'Queueing sync…'
                  : extendedWindow ? 'Calculate messages & estimate' : 'Sync selected channels'} <ArrowRightIcon />
              </button>
            </footer>
          </>
        ) : (
          <SlackHistoryChannelsState
            title="Channel discovery is unavailable"
            detail="Retry to ask the connected Slack workspace for eligible public channels."
            onRetry={onRetry}
          />
        )}
      </section>
    </main>
  )
}

function SlackHistoryEstimateStep({
  run,
  channelCount,
  busy,
  onBack,
  onStart,
}: {
  run: SlackHistorySyncRun | null
  channelCount: number
  busy: boolean
  onBack: () => void
  onStart: () => void
}) {
  const failed = run?.status === 'failed' || run?.phase === 'failed'
  const ready = run?.phase === 'awaiting_confirmation' && run.estimatedMessageCount !== null
  const messageCount = run?.estimatedMessageCount ?? 0
  const processingDays = run?.estimatedProcessingDays ?? Math.ceil(messageCount / 500)
  const pricing = run?.pricing

  if (!run || (!ready && !failed)) {
    return (
      <main className="brain-onboarding-slack brain-onboarding-slack--estimate">
        <section className="brain-onboarding-slack__estimate" aria-labelledby="brain-onboarding-title">
          <span className="brain-onboarding-slack__spinner" aria-hidden="true" />
          <span className="brain-onboarding-slack__eyebrow">Calculating your sync</span>
          <h1 id="brain-onboarding-title" tabIndex={-1}>Counting eligible Slack messages.</h1>
          <p>
            We’re scanning {channelCount} {channelCount === 1 ? 'public channel' : 'public channels'} across the
            selected history window. This can take a while because Slack limits how quickly history can be read.
          </p>
          <div className="brain-onboarding-slack__privacy-note">
            <strong>No memory sync has started</strong>
            <span>You’ll review the message count, estimated duration, and promotional price before anything is added.</span>
          </div>
        </section>
      </main>
    )
  }

  if (failed) {
    return (
      <main className="brain-onboarding-slack brain-onboarding-slack--estimate">
        <section className="brain-onboarding-slack__estimate" aria-labelledby="brain-onboarding-title">
          <span className="brain-onboarding-slack__eyebrow">Estimate unavailable</span>
          <h1 id="brain-onboarding-title" tabIndex={-1}>We couldn’t finish counting this Slack history.</h1>
          <p>{run.lastError || 'Go back and retry. No messages were added to memory.'}</p>
          <button type="button" className="brain-onboarding-slack__secondary" onClick={onBack}>
            <ArrowLeftIcon /> Back to channels
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="brain-onboarding-slack brain-onboarding-slack--estimate">
      <section className="brain-onboarding-slack__estimate" aria-labelledby="brain-onboarding-title">
        <span className="brain-onboarding-slack__eyebrow">Estimate ready</span>
        <h1 id="brain-onboarding-title" tabIndex={-1}>Review your Slack history sync.</h1>
        <p>We counted the eligible public-channel messages. The sync begins only after you press Start.</p>
        <div className="brain-onboarding-slack__estimate-grid">
          <div><span>Messages</span><strong>{formatCount(messageCount)}</strong></div>
          <div><span>History</span><strong>{run.windowDays} days</strong></div>
          <div><span>Channels</span><strong>{channelCount}</strong></div>
          <div><span>Estimated time</span><strong>{formatEstimatedDays(processingDays)}</strong></div>
        </div>
        <div className="brain-onboarding-slack__price">
          <div>
            <span>History processing</span>
            <small>{formatMoney(pricing?.unitPriceCents ?? 100, pricing?.currency ?? 'USD')} per {pricing?.unitMessages ?? 10} messages</small>
          </div>
          <p>
            <del>{formatMoney(pricing?.listPriceCents ?? Math.ceil(messageCount / 10) * 100, pricing?.currency ?? 'USD')}</del>
            <strong>Free</strong>
            <span>{pricing?.promotionLabel || 'For a limited time'}</span>
          </p>
        </div>
        <div className="brain-onboarding-slack__privacy-note">
          <strong>Up to {formatCount(run.messageLimitPerDay ?? 500)} messages each day</strong>
          <span>
            The sync continues in the background for {formatEstimatedDays(processingDays)}. Dashboard progress
            will show how far back memory has reached and the remaining estimate.
          </span>
        </div>
        <div className="brain-onboarding-slack__estimate-actions">
          <button type="button" className="brain-onboarding-slack__secondary" disabled={busy} onClick={onBack}>
            <ArrowLeftIcon /> Back
          </button>
          <button type="button" className="brain-onboarding-slack__primary" disabled={busy} onClick={onStart}>
            {busy ? 'Starting sync…' : 'Start Slack sync'} <ArrowRightIcon />
          </button>
        </div>
      </section>
    </main>
  )
}

function SlackHistoryChannelsState({
  title,
  detail,
  onRetry,
}: {
  title: string
  detail: string
  onRetry: () => void
}) {
  return (
    <div className="brain-onboarding-slack__state" role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      <button type="button" onClick={onRetry}>Retry channel discovery</button>
    </div>
  )
}

function CompanyMailboxOnboardingStep({
  summary,
  loadState,
  localPart,
  displayName,
  organizationName,
  slackChannels,
  slackChannelsLoadState,
  slackChannelsRetryAt,
  slackDeliveryEnabled,
  slackDeliveryChannelId,
  slackDeliveryChannelValid,
  retrySeconds,
  createRequestPending,
  busy,
  onLocalPartChange,
  onDisplayNameChange,
  onSlackDeliveryEnabledChange,
  onSlackDeliveryChannelChange,
  onRetrySlackChannels,
  onCreate,
  onRetry,
}: {
  summary: CompanyMailboxSummary | null
  loadState: MailboxLoadState
  localPart: string
  displayName: string
  organizationName: string
  slackChannels: CompanyMailboxSlackChannels | null
  slackChannelsLoadState: CompanyMailboxSlackChannelsLoadState
  slackChannelsRetryAt: number | null
  slackDeliveryEnabled: boolean
  slackDeliveryChannelId: string
  slackDeliveryChannelValid: boolean
  retrySeconds: number
  createRequestPending: boolean
  busy: boolean
  onLocalPartChange: (value: string) => void
  onDisplayNameChange: (value: string) => void
  onSlackDeliveryEnabledChange: (enabled: boolean) => void
  onSlackDeliveryChannelChange: (channelId: string) => void
  onRetrySlackChannels: () => void
  onCreate: () => void
  onRetry: () => void
}) {
  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <main className="brain-onboarding-slack brain-onboarding-mailbox">
        <div className="brain-onboarding-slack__state" role="status" aria-live="polite">
          <span className="brain-onboarding-slack__spinner" aria-hidden="true" />
          <strong>Checking company email</strong>
          <p>Looking for an existing mailbox for this organization.</p>
        </div>
      </main>
    )
  }
  if (loadState === 'error' || !summary) {
    return (
      <main className="brain-onboarding-slack brain-onboarding-mailbox">
        <div className="brain-onboarding-slack__state" role="status">
          <strong>Company email could not be loaded</strong>
          <p>Retry this optional step, or use Skip for now above and configure it later.</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      </main>
    )
  }

  const normalizedLocalPart = localPart.trim().toLowerCase()
  const valid = MAILBOX_LOCAL_PART.test(normalizedLocalPart)
  const preview = summary.addressPreview || 'memcode@agentmail.to'
  const at = preview.lastIndexOf('@')
  const domain = at >= 0 ? preview.slice(at + 1) : 'agentmail.to'
  const address = `${normalizedLocalPart || 'memcode'}@${domain}`
  const slackDeliveryValid = !slackDeliveryEnabled || slackDeliveryChannelValid

  return (
    <main className="brain-onboarding-slack brain-onboarding-mailbox">
      <section className="brain-onboarding-mailbox__layout" aria-labelledby="brain-onboarding-title">
        <div className="brain-onboarding-mailbox__copy">
          <span className="brain-onboarding-slack__eyebrow">Optional company email</span>
          <h1 id="brain-onboarding-title" tabIndex={-1}>Give Company Brain its own email.</h1>
          <p>Create a real mailbox your agents can use to receive messages and send mail through your existing approval flow.</p>
          <ul>
            <li><CheckIcon /> Receive messages in one organization inbox</li>
            <li><CheckIcon /> Send only through the governed approval flow</li>
            <li><CheckIcon /> Review received mail from the dashboard</li>
          </ul>
          <div className="brain-onboarding-slack__privacy-note">
            <strong>Already planning to use Gmail or your own email?</strong>
            <span>Use Skip for now. You can configure this mailbox later from Brain settings.</span>
          </div>
        </div>
        <div className="brain-onboarding-mailbox__form">
          <div className="brain-onboarding-mailbox__preview" aria-live="polite">
            <span>Your Company Brain email</span>
            <strong>{address}</strong>
            <small>The final address is confirmed when it is created.</small>
          </div>
          <label>
            <span>Email name</span>
            <div><input
              value={localPart}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={normalizedLocalPart.length > 0 && !valid}
              disabled={busy || createRequestPending || summary.status === 'provisioning' || summary.status === 'ready' || !summary.canManage}
              onChange={(event) => onLocalPartChange(event.target.value)}
            /><i>@{domain}</i></div>
            <small>Use lowercase letters, numbers, dots, dashes or underscores.</small>
          </label>
          <label>
            <span>Display name</span>
            <input
              value={displayName || `${organizationName} Company Brain`}
              maxLength={100}
              disabled={busy || createRequestPending || summary.status === 'provisioning' || summary.status === 'ready' || !summary.canManage}
              onChange={(event) => onDisplayNameChange(event.target.value)}
            />
          </label>
          <CompanyMailboxSlackDelivery
            compact
            channels={slackChannels}
            loadState={slackChannelsLoadState}
            enabled={slackDeliveryEnabled}
            selectedChannelId={slackDeliveryChannelId}
            currentTeamId={summary.slackDelivery.teamId}
            currentChannelId={summary.slackDelivery.channelId}
            currentChannelName={summary.slackDelivery.channelName}
            retryAt={slackChannelsRetryAt}
            disabled={busy || createRequestPending || summary.status === 'provisioning' || !summary.canManage}
            onEnabledChange={onSlackDeliveryEnabledChange}
            onChannelChange={onSlackDeliveryChannelChange}
            onRetry={onRetrySlackChannels}
          />
          {!summary.canManage ? <p role="status">An organization admin or owner can create this email.</p> : null}
          <button
            type="button"
            className="brain-onboarding-slack__primary"
            disabled={busy || retrySeconds > 0 || !summary.canManage || !valid || !slackDeliveryValid || summary.status === 'provisioning'}
            onClick={onCreate}
          >
            {busy
              ? summary.status === 'ready' ? 'Saving Slack delivery…' : 'Creating company email…'
              : retrySeconds > 0
                ? `Try again in ${retrySeconds}s`
                : summary.status === 'provisioning'
                  ? 'Preparing company email…'
                  : summary.status === 'ready'
                    ? slackDeliveryEnabled ? 'Save Slack delivery' : 'Continue without Slack delivery'
                  : createRequestPending
                    ? 'Retry company email'
                  : 'Create company email'} <ArrowRightIcon />
          </button>
        </div>
      </section>
    </main>
  )
}

function SlackHistoryQueuedStep({
  run,
  channelCount,
  slackSkipped,
  mailboxSummary,
  researchActive,
  busy,
  onFinish,
}: {
  run: SlackHistorySyncRun | null
  channelCount: number
  slackSkipped: boolean
  mailboxSummary: CompanyMailboxSummary | null
  researchActive: boolean
  busy: boolean
  onFinish: () => void
}) {
  return (
    <main className="brain-onboarding-slack brain-onboarding-slack--queued">
      <section className="brain-onboarding-slack__hero" aria-labelledby="brain-onboarding-title">
        <div className="brain-onboarding-slack__queued-mark" aria-hidden="true"><MemoryIcon /></div>
        <span className="brain-onboarding-slack__eyebrow">Setup ready</span>
        <h1 id="brain-onboarding-title" tabIndex={-1}>You’re ready to keep working.</h1>
        <p>{run
          ? `Memcode is syncing the last ${run.windowDays} days from ${channelCount} ${channelCount === 1 ? 'public channel' : 'public channels'} in the background.`
          : 'You can finish now and return to the optional setup steps from the dashboard whenever you are ready.'}</p>
        <dl className="brain-onboarding-slack__queued-details">
          <div><dt>Slack history</dt><dd>{run ? 'Queued' : slackSkipped ? 'Skipped for now' : 'Not queued'}</dd></div>
          <div>
            <dt>Company email</dt>
            <dd>{mailboxSummary?.status === 'ready'
              ? mailboxSummary.address
              : mailboxSummary?.status === 'provisioning'
                ? 'Preparing'
                : mailboxSummary?.status === 'skipped'
                  ? 'Skipped for now'
                  : 'Not created'}</dd>
          </div>
          <div><dt>Setup</dt><dd>{run ? formatSlackSyncPhase(run.phase || run.status) : 'Ready to finish'}</dd></div>
          {run?.estimatedMessageCount !== null && run?.estimatedMessageCount !== undefined ? (
            <div>
              <dt>Estimated duration</dt>
              <dd>{formatEstimatedDays(run.estimatedProcessingDays ?? Math.ceil(run.estimatedMessageCount / 500))}</dd>
            </div>
          ) : null}
        </dl>
        {researchActive ? (
          <div className="brain-onboarding-slack__privacy-note" role="status">
            <strong>Company research is still running</strong>
            <span>Finish setup now to close this screen. Onboarding will remain available from the dashboard while research completes.</span>
          </div>
        ) : null}
        <button type="button" className="brain-onboarding-slack__primary" disabled={busy} onClick={onFinish}>
          {busy ? 'Finishing setup…' : 'Finish setup'} <ArrowRightIcon />
        </button>
      </section>
    </main>
  )
}

function DomainStep({
  initialDomain,
  busy,
  researchAvailable,
  onSubmit,
}: {
  initialDomain: string
  busy: boolean
  researchAvailable: boolean
  onSubmit: (domain: string) => Promise<void>
}) {
  const [domain, setDomain] = useState(initialDomain)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDomain((current) => current || initialDomain)
  }, [initialDomain])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const normalized = normalizeDomainInput(domain)
      setError(null)
      void onSubmit(normalized)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Enter a valid company domain.')
    }
  }

  return (
    <main className="brain-onboarding-domain">
      <div className="brain-onboarding-domain__background" aria-hidden="true">
        <img src="/company_brain_1.jpeg" alt="" decoding="async" fetchPriority="high" />
      </div>
      <form className="brain-onboarding-domain__card" onSubmit={submit}>
        <h1 id="brain-onboarding-title">Build your company brief.</h1>
        <p>
          memCode will map the official site, search the web and recent news, then return a sourced brief for you
          to review before anything enters memory.
        </p>
        <label className="sr-only" htmlFor="company-onboarding-domain">Company domain</label>
        <div className="brain-onboarding-domain__input">
          <span aria-hidden="true">https://</span>
          <input
            id="company-onboarding-domain"
            name="domain"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="example.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={!researchAvailable
              ? 'company-onboarding-domain-help'
              : error
                ? 'company-onboarding-domain-error'
                : undefined}
            disabled={busy || !researchAvailable}
          />
          <button className="btn btn--primary" type="submit" disabled={busy || !researchAvailable || !domain.trim()}>
            {busy ? 'Starting research…' : 'Research company'}
          </button>
        </div>
        {!researchAvailable ? (
          <small id="company-onboarding-domain-help" className="brain-onboarding-domain__error">
            Company research is temporarily unavailable. Please try again shortly.
          </small>
        ) : error ? (
          <small id="company-onboarding-domain-error" className="brain-onboarding-domain__error">{error}</small>
        ) : null}
      </form>
    </main>
  )
}

function ResearchWorkspace({
  run,
  organizationName,
  slackConnected,
  busyAction,
  onConnectSlack,
  onOpenAccount,
  onOpenConnectors,
}: {
  run: CompanyResearchRun
  organizationName: string
  slackConnected: boolean
  busyAction: string | null
  onConnectSlack: () => void
  onOpenAccount: () => void
  onOpenConnectors: () => void
}) {
  const phases = derivedPhases(run)
  const readyCards = run.cards.filter((card) => card.status === 'ready' || card.status === 'partial')
  const activePhase = phases.find((phase) => phase.status === 'running')
    ?? phases.find((phase) => phase.status === 'pending')
    ?? phases[phases.length - 1]
  const activePhaseDetail = activePhase && 'detail' in activePhase ? activePhase.detail : undefined
  const completedPhases = phases.filter((phase) => phase.status === 'done').length

  return (
    <main className="brain-onboarding-research">
      <section className="brain-onboarding-research__main" aria-labelledby="brain-onboarding-title">
        <header className="brain-onboarding-research__heading">
          <div>
            <h1 id="brain-onboarding-title">Learning how {organizationName} works.</h1>
            <p>Mapping the company, its products, and the public context around it.</p>
          </div>
          <div
            className="brain-onboarding-progress"
            role="progressbar"
            aria-label="Company research progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(run.progress)}
          >
            <div><span>Research</span><strong>{Math.round(run.progress)}%</strong></div>
            <span><i style={{ width: `${run.progress}%` }} /></span>
          </div>
        </header>

        <div className="brain-onboarding-research__workspace">
          <section className="brain-onboarding-research__active" aria-label="Current research stage">
            <div>
              <strong key={activePhase?.key} className="brain-onboarding-research__active-copy" aria-live="polite">
                {activePhase?.label || 'Preparing the company brief'}
              </strong>
              <p>{activePhaseDetail || 'Public sources are being checked and organized into a reviewable brief.'}</p>
            </div>
            <dl>
              <div><dt>Stages complete</dt><dd>{completedPhases}/{phases.length}</dd></div>
              <div><dt>Findings ready</dt><dd>{readyCards.length}</dd></div>
              <div><dt>Sources found</dt><dd>{run.sources.length}</dd></div>
            </dl>
          </section>

          <ol className="brain-onboarding-phase-grid" aria-label="Research stages">
            {phases.map((phase, index) => (
              <li key={phase.key} className={`brain-onboarding-phase-card is-${phase.status}`}>
                <span className="brain-onboarding-phase-card__marker" aria-hidden="true">
                  {phase.status === 'done' ? <CheckIcon /> : String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <small>{phase.status === 'done' ? 'Complete' : phase.status === 'running' ? 'In progress' : 'Queued'}</small>
                  <strong>{phase.label}</strong>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {readyCards.length ? (
          <section className="brain-onboarding-findings" aria-label="Research findings collected so far">
            <header>
              <h2>Evidence collected</h2>
              <small>{readyCards.length} {readyCards.length === 1 ? 'section' : 'sections'} ready</small>
            </header>
            <div className="brain-onboarding-findings__grid">
              {readyCards.map((card) => (
                <article key={`evidence-${card.key}`} className="brain-onboarding-evidence">
                  <h3>{card.label}</h3>
                  <p>{card.summary || 'Public evidence collected.'}</p>
                  {card.highlights.length ? (
                    <ul>{card.highlights.slice(0, 2).map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="brain-onboarding-actions" aria-label="Setup actions while research runs">
          <header>
            <h2>Continue setup while research runs</h2>
            <small>Optional</small>
          </header>
          <div className="brain-onboarding-actions__grid">
            <ActionCard
              title={slackConnected ? 'Slack is connected' : 'Add Memcode to Slack'}
              description={slackConnected
                ? 'The workspace is ready for Company Brain.'
                : 'Bring shared context into the conversations where work happens.'}
              action={slackConnected ? 'Connected' : busyAction === 'slack' ? 'Opening Slack…' : 'Add to Slack'}
              leadingIcon={<SlackMark />}
              disabled={slackConnected || busyAction !== null}
              onClick={onConnectSlack}
            />
            <ActionCard
              title="Connect company apps"
              description="Add Notion, Gmail, Drive, Jira and other sources after the brief is ready."
              action="View connectors"
              onClick={onOpenConnectors}
            />
            <ActionCard
              title="Invite your team"
              description="Give verified members access and choose who can manage Company Brain."
              action="Open people settings"
              onClick={onOpenAccount}
            />
          </div>
        </section>
      </section>
    </main>
  )
}

function ActionCard({
  title,
  description,
  action,
  leadingIcon,
  disabled = false,
  onClick,
}: {
  title: string
  description: string
  action: string
  leadingIcon?: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <article className="brain-onboarding-action-card">
      <div><strong>{title}</strong><p>{description}</p></div>
      <button type="button" disabled={disabled} onClick={onClick}>{leadingIcon}{action}<ArrowRightIcon /></button>
    </article>
  )
}

function ResearchReview({
  run,
  organizationName,
  activeCard,
  researchAttempts,
  researchAttemptLimit,
  slackConnected,
  busyAction,
  editingCardKey,
  onActiveCardChange,
  onEditingCardChange,
  onConnectSlack,
  onChangeWebsite,
  onRetry,
  onUpdateCard,
  onFinish,
}: {
  run: CompanyResearchRun
  organizationName: string
  activeCard: number
  researchAttempts: number
  researchAttemptLimit: number
  slackConnected: boolean
  busyAction: string | null
  editingCardKey: string | null
  onActiveCardChange: (index: number) => void
  onEditingCardChange: (cardKey: string, editing: boolean) => void
  onConnectSlack: () => void
  onChangeWebsite: () => void
  onRetry: () => void
  onUpdateCard: (input: CompanyResearchCardUpdateInput) => Promise<boolean>
  onFinish: () => void
}) {
  const slides = useMemo(() => [
    ...run.cards.map((card) => ({ kind: 'card' as const, key: card.key, card })),
    ...(run.sources.length > 0
      ? [{ kind: 'sources' as const, key: 'sources-and-next-steps' }]
      : []),
  ], [run.cards, run.sources.length])
  const hasBrief = slides.length > 0
  const safeIndex = Math.min(activeCard, Math.max(0, slides.length - 1))
  const slide = slides[safeIndex]
  const retriesRemaining = Math.max(0, researchAttemptLimit - researchAttempts)
  const cardSaveInProgress = busyAction?.startsWith('research-card:') ?? false
  const cardNavigationLocked = editingCardKey !== null || cardSaveInProgress
  const memoryCopy = run.memoryStatus === 'failed' || run.memoryStatus === 'partial'
    ? null
    : run.memoryStatus === 'ready'
      ? {
          title: 'Company research saved to memory',
          detail: 'The Slack agent can recall these source-backed findings across the organization.',
        }
      : run.memoryStatus === 'deferred'
        ? {
            title: 'Company research is not in memory yet',
            detail: 'The source-backed brief remains available; organization memory can be enabled later.',
          }
      : {
          title: 'Company research is waiting for memory',
          detail: slackConnected
            ? 'Slack is connected; organization memory publication will finish automatically.'
            : 'Connect Slack to publish these findings to organization memory.',
        }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (
      cardNavigationLocked
      || (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]'))
    ) return
    if (event.key === 'ArrowLeft' && safeIndex > 0) {
      event.preventDefault()
      onActiveCardChange(safeIndex - 1)
    }
    if (event.key === 'ArrowRight' && safeIndex < slides.length - 1) {
      event.preventDefault()
      onActiveCardChange(safeIndex + 1)
    }
  }

  return (
    <main className="brain-onboarding-review" onKeyDown={handleKeyDown}>
      <header className="brain-onboarding-review__heading">
        <div>
          <h1 id="brain-onboarding-title">Here is what we learned about {organizationName}.</h1>
          <p>Review the brief one section at a time. Edit if needed.</p>
        </div>
        <div className="brain-onboarding-review__count">
          <strong>{run.sources.length}</strong>
          <span>sources</span>
        </div>
      </header>

      {run.status === 'failed' ? (
        <section className="brain-onboarding-failed" role="alert">
          <div>
            <span>Research stopped</span>
            <strong>
              {userFacingCodeMessage(
                run.error,
                'We could not complete research for this website. Check the address or enter a different website.',
                ONBOARDING_ERROR_MESSAGES,
              )}
            </strong>
            <p>Review any collected evidence below, or correct the website before starting another run.</p>
          </div>
          <div className="brain-onboarding-failed__actions">
            <button
              type="button"
              className="brain-onboarding-failed__change-domain"
              disabled={busyAction !== null}
              onClick={onChangeWebsite}
            >
              Change website
            </button>
            <button type="button" disabled={busyAction !== null || retriesRemaining === 0} onClick={onRetry}>
              {busyAction === 'research'
                ? 'Retrying…'
                : retriesRemaining > 0
                  ? `Retry research · ${retriesRemaining} left`
                  : 'Retry limit reached'}
            </button>
          </div>
        </section>
      ) : null}

      {run.status === 'partial' ? (
        <section className="brain-onboarding-failed brain-onboarding-failed--partial" role="status">
          <div>
            <span>Partial research run</span>
            <strong>Some sources were unavailable, but the collected evidence is ready to review.</strong>
            <p>Use the source list to confirm important details before relying on this brief.</p>
          </div>
        </section>
      ) : null}

      {hasBrief ? (
        <section className="brain-onboarding-carousel" aria-roledescription="carousel" aria-label="Company research brief">
          <div className="brain-onboarding-carousel__rail" aria-label="Research sections">
            {slides.map((entry, index) => (
              <button
                key={entry.key}
                type="button"
                className={index === safeIndex ? 'is-active' : ''}
                aria-current={index === safeIndex ? 'step' : undefined}
                disabled={cardNavigationLocked}
                onClick={() => onActiveCardChange(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{entry.kind === 'card' ? entry.card.label : 'Sources & next steps'}</strong>
              </button>
            ))}
          </div>

          <div className="brain-onboarding-carousel__stage">
            {slide?.kind === 'card' ? (
              <ResearchCardSlide
                key={slide.card.key}
                runId={run.id}
                revision={run.revision}
                card={slide.card}
                sources={run.sources}
                editing={editingCardKey === slide.card.key}
                canEdit={run.status === 'ready' || run.status === 'partial'}
                disabled={busyAction !== null}
                saving={busyAction === `research-card:${slide.card.key}`}
                onSave={onUpdateCard}
                onEditingChange={onEditingCardChange}
              />
            ) : (
              <SourcesSlide run={run} />
            )}
            <footer className="brain-onboarding-carousel__controls">
              <button
                type="button"
                disabled={cardNavigationLocked || safeIndex === 0}
                onClick={() => onActiveCardChange(Math.max(0, safeIndex - 1))}
              >
                <ArrowLeftIcon /> Previous
              </button>
              <div aria-label={`Slide ${safeIndex + 1} of ${slides.length}`}>
                {slides.map((entry, index) => (
                  <button
                    key={`dot-${entry.key}`}
                    type="button"
                    aria-label={`Show ${entry.kind === 'card' ? entry.card.label : 'sources and next steps'}`}
                    aria-current={index === safeIndex ? 'step' : undefined}
                    className={index === safeIndex ? 'is-active' : ''}
                    disabled={cardNavigationLocked}
                    onClick={() => onActiveCardChange(index)}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={cardNavigationLocked || safeIndex === slides.length - 1}
                onClick={() => onActiveCardChange(Math.min(slides.length - 1, safeIndex + 1))}
              >
                Next <ArrowRightIcon />
              </button>
            </footer>
          </div>
        </section>
      ) : null}

      <footer className={`brain-onboarding-review__actions${memoryCopy ? '' : ' brain-onboarding-review__actions--without-memory'}`}>
        {memoryCopy ? (
          <div className="brain-onboarding-memory-status">
            <span aria-hidden="true"><MemoryIcon /></span>
            <div>
              <strong>{memoryCopy.title}</strong>
              <p>{memoryCopy.detail}</p>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="brain-onboarding-review__slack"
          disabled={cardNavigationLocked || slackConnected || busyAction !== null}
          onClick={onConnectSlack}
        >
          <SlackMark />
          <span>{slackConnected ? 'Slack connected' : busyAction === 'slack' ? 'Opening Slack…' : 'Add to Slack'}</span>
        </button>
        <button
          type="button"
          className="brain-onboarding-review__finish"
          disabled={cardNavigationLocked || busyAction !== null || run.status === 'failed'}
          onClick={onFinish}
        >
          {busyAction === 'complete' ? 'Finishing setup…' : 'Finish setup'}
        </button>
      </footer>
    </main>
  )
}

function ResearchCardSlide({
  runId,
  revision,
  card,
  sources,
  editing,
  canEdit,
  disabled,
  saving,
  onSave,
  onEditingChange,
}: {
  runId: string
  revision: number
  card: CompanyResearchCard
  sources: CompanyResearchSource[]
  editing: boolean
  canEdit: boolean
  disabled: boolean
  saving: boolean
  onSave: (input: CompanyResearchCardUpdateInput) => Promise<boolean>
  onEditingChange: (cardKey: string, editing: boolean) => void
}) {
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const cardSources = card.sourceIds.map((id) => sourceMap.get(id)).filter(Boolean) as CompanyResearchSource[]
  const highlightsValue = card.highlights.join('\n')
  const [draftSummary, setDraftSummary] = useState(card.summary)
  const [draftHighlights, setDraftHighlights] = useState(highlightsValue)
  const [validationError, setValidationError] = useState<string | null>(null)
  const editable = canEdit
    && revision >= 1
    && card.status === 'ready'
    && card.key !== 'research_coverage'
    && cardSources.length > 0

  useEffect(() => {
    if (editing) return
    setDraftSummary(card.summary)
    setDraftHighlights(highlightsValue)
    setValidationError(null)
  }, [card.key, card.summary, editing, highlightsValue, revision])

  useEffect(() => () => onEditingChange(card.key, false), [card.key, onEditingChange])

  const cancelEditing = () => {
    setDraftSummary(card.summary)
    setDraftHighlights(highlightsValue)
    setValidationError(null)
    onEditingChange(card.key, false)
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const summary = draftSummary.trim()
    const highlights = draftHighlights
      .split(/\r?\n/u)
      .map((highlight) => highlight.trim())
      .filter(Boolean)

    if (!summary) {
      setValidationError('Add a summary before saving.')
      return
    }
    if (summary.length > COMPANY_RESEARCH_EDIT_LIMITS.summaryLength) {
      setValidationError(`Keep the summary under ${COMPANY_RESEARCH_EDIT_LIMITS.summaryLength.toLocaleString()} characters.`)
      return
    }
    if (highlights.length > COMPANY_RESEARCH_EDIT_LIMITS.highlights) {
      setValidationError(`Use up to ${COMPANY_RESEARCH_EDIT_LIMITS.highlights} highlights, one per line.`)
      return
    }
    if (highlights.some((highlight) => highlight.length > COMPANY_RESEARCH_EDIT_LIMITS.highlightLength)) {
      setValidationError(`Keep each highlight under ${COMPANY_RESEARCH_EDIT_LIMITS.highlightLength.toLocaleString()} characters.`)
      return
    }

    setValidationError(null)
    const saved = await onSave({ runId, cardKey: card.key, revision, summary, highlights })
    if (saved) {
      onEditingChange(card.key, false)
    }
  }

  return (
    <article className="brain-onboarding-slide" aria-labelledby={`research-slide-${card.key}`}>
      <header>
        <h2 id={`research-slide-${card.key}`}>{card.label}</h2>
        <div className="brain-onboarding-slide__heading-actions">
          <small>{cardSources.length} {cardSources.length === 1 ? 'source' : 'sources'}</small>
          {editable && !editing ? (
            <button
              type="button"
              aria-label={`Edit ${card.label}`}
              disabled={disabled}
              onClick={() => {
                setValidationError(null)
                onEditingChange(card.key, true)
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
      </header>
      {editing ? (
        <form className="brain-onboarding-slide__editor" onSubmit={(event) => void save(event)} aria-busy={saving}>
          <label>
            <span>Summary</span>
            <textarea
              rows={6}
              maxLength={COMPANY_RESEARCH_EDIT_LIMITS.summaryLength}
              value={draftSummary}
              disabled={saving}
              onChange={(event) => setDraftSummary(event.target.value)}
            />
            <small>{draftSummary.length.toLocaleString()} / {COMPANY_RESEARCH_EDIT_LIMITS.summaryLength.toLocaleString()}</small>
          </label>
          <label>
            <span>Highlights</span>
            <textarea
              rows={7}
              value={draftHighlights}
              disabled={saving}
              placeholder="One highlight per line"
              onChange={(event) => setDraftHighlights(event.target.value)}
            />
            <small>One highlight per line, up to {COMPANY_RESEARCH_EDIT_LIMITS.highlights}.</small>
          </label>
          {validationError ? <p className="brain-onboarding-slide__editor-error" role="alert">{validationError}</p> : null}
          <div className="brain-onboarding-slide__editor-actions">
            <button type="button" disabled={saving} onClick={cancelEditing}>Cancel</button>
            <button type="submit" disabled={disabled}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      ) : (
        <div className={`brain-onboarding-slide__grid${card.highlights.length ? '' : ' is-single'}`}>
          <section className="brain-onboarding-slide__overview">
            <p className="brain-onboarding-slide__summary">{card.summary || 'No source-backed summary was returned for this section.'}</p>
            {card.stats.length ? (
              <div className="brain-onboarding-slide__stats">
                {card.stats.map((stat) => <div key={`${stat.label}-${stat.value}`}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}
              </div>
            ) : null}
          </section>
          {card.highlights.length ? (
            <section className="brain-onboarding-slide__highlights">
              <h3>What stood out</h3>
              <ul>{card.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            </section>
          ) : null}
        </div>
      )}
      {cardSources.length ? (
        <SourceList sources={cardSources} compact />
      ) : null}
    </article>
  )
}

function SourcesSlide({ run }: { run: CompanyResearchRun }) {
  return (
    <article className="brain-onboarding-slide brain-onboarding-slide--sources" aria-labelledby="research-slide-sources">
      <header>
        <h2 id="research-slide-sources">Sources and next steps</h2>
        <small>{run.sources.length} total</small>
      </header>
      <SourceList sources={run.sources} />
    </article>
  )
}

function SourceList({ sources, compact = false }: { sources: CompanyResearchSource[]; compact?: boolean }) {
  const visible = compact ? sources.slice(0, 5) : sources.slice(0, 16)
  return (
    <section className="brain-onboarding-sources" aria-label="Research sources">
      <h3>Sources</h3>
      <ul>
        {visible.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              <span>{hostname(source.url)}</span>
              <strong>{source.title}</strong>
              <ExternalLinkIcon />
            </a>
          </li>
        ))}
      </ul>
      {visible.length < sources.length ? <small>+ {sources.length - visible.length} more sources in this brief</small> : null}
    </section>
  )
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.75 4.25 12.5 8l-3.75 3.75" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8H4M7.25 4.25 3.5 8l3.75 3.75" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.25 3.5H3.5v9h9V9.75M8.5 3.5h4v4M7.25 8.75 12.5 3.5" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3 3" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8.25 2.75 2.75 6.25-6.25" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.75 16.25 6v8L10 17.25 3.75 14V6L10 2.75Z" />
      <path d="m3.75 6 6.25 3.25L16.25 6M10 9.25v8" />
    </svg>
  )
}

function derivedPhases(run: CompanyResearchRun) {
  if (run.phases.length) return run.phases
  const currentIndex = Math.max(0, RESEARCH_PHASES.findIndex((phase) => phase.key === run.phase))
  return RESEARCH_PHASES.map((phase, index) => ({
    ...phase,
    status: index < currentIndex ? 'done' as const : index === currentIndex ? 'running' as const : 'pending' as const,
  }))
}

function normalizeDomainInput(value: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error('Enter your company domain.')
  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(normalized) ? normalized : `https://${normalized}`
  const url = new URL(candidate)
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('Use only the public domain, such as example.com.')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (!host.includes('.') || host.length > 253 || host === 'localhost') {
    throw new Error('Enter a valid public company domain.')
  }
  return host
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./u, '')
  } catch {
    return 'Source'
  }
}

function formatSlackSyncPhase(value: string) {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.max(0, value))
}

function formatEstimatedDays(value: number) {
  const days = Math.max(0, Math.ceil(value))
  if (days === 0) return 'less than 1 day'
  return `about ${days} ${days === 1 ? 'day' : 'days'}`
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: /^[A-Z]{3}$/u.test(currency) ? currency : 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(Math.max(0, cents) / 100)
}

function slackCallbackFromLocation() {
  return new URLSearchParams(window.location.search).get('onboarding') === 'slack'
}

function slackHistorySkipKey(organizationId: string) {
  return `${SLACK_HISTORY_SKIP_KEY_PREFIX}${encodeURIComponent(organizationId)}`
}

function readSlackHistorySkipped(organizationId: string) {
  try {
    return window.localStorage.getItem(slackHistorySkipKey(organizationId)) === 'true'
  } catch {
    return false
  }
}

function writeSlackHistorySkipped(organizationId: string, skipped: boolean) {
  try {
    const key = slackHistorySkipKey(organizationId)
    if (skipped) window.localStorage.setItem(key, 'true')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function queuedSlackHistoryKey(organizationId: string) {
  return `${SLACK_HISTORY_QUEUED_KEY_PREFIX}${encodeURIComponent(organizationId)}`
}

function readQueuedSlackHistorySync(organizationId: string): {
  run: SlackHistorySyncRun
  channelCount: number
  proactivityEnabled: boolean
} | null {
  try {
    const raw = window.localStorage.getItem(queuedSlackHistoryKey(organizationId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isPlainRecord(value) || !isPlainRecord(value.run)) return null
    if (
      typeof value.channelCount !== 'number'
      || !Number.isSafeInteger(value.channelCount)
      || value.channelCount < 1
      || value.channelCount > 5_000
    ) return null
    return {
      run: parseSlackHistorySyncRun(value.run),
      channelCount: value.channelCount,
      proactivityEnabled: value.proactivityEnabled === true,
    }
  } catch {
    return null
  }
}

function slackHistoryEstimateKey(organizationId: string) {
  return `${SLACK_HISTORY_ESTIMATE_KEY_PREFIX}${encodeURIComponent(organizationId)}`
}

function readSlackHistoryEstimate(organizationId: string): {
  run: SlackHistorySyncRun
  channelCount: number
  proactivityEnabled: boolean
} | null {
  try {
    const raw = window.localStorage.getItem(slackHistoryEstimateKey(organizationId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      !isPlainRecord(value)
      || !isPlainRecord(value.run)
      || typeof value.channelCount !== 'number'
      || !Number.isSafeInteger(value.channelCount)
      || value.channelCount < 1
      || value.channelCount > 5_000
    ) return null
    const run = parseSlackHistorySyncRun(value.run)
    if (!run.requiresConfirmation || run.syncStarted) return null
    return {
      run,
      channelCount: value.channelCount,
      proactivityEnabled: value.proactivityEnabled === true,
    }
  } catch {
    return null
  }
}

function writeSlackHistoryEstimate(
  organizationId: string,
  value: {
    run: SlackHistorySyncRun
    channelCount: number
    proactivityEnabled: boolean
  } | null,
) {
  try {
    const key = slackHistoryEstimateKey(organizationId)
    if (value) window.localStorage.setItem(key, JSON.stringify(value))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function writeQueuedSlackHistorySync(
  organizationId: string,
  value: {
    run: SlackHistorySyncRun
    channelCount: number
    proactivityEnabled: boolean
  } | null,
) {
  try {
    const key = queuedSlackHistoryKey(organizationId)
    if (value) window.localStorage.setItem(key, JSON.stringify(value))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthenticationError(error: unknown) {
  return (
    (error instanceof CompanyOnboardingHttpError || error instanceof BrainIntegrationHttpError)
    && error.status === 401
  )
}

function isMailboxAuthenticationError(error: unknown) {
  return error instanceof CompanyMailboxHttpError && error.status === 401
}

function onboardingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof CompanyOnboardingHttpError) {
    return userFacingCodeMessage(error.code, fallback, ONBOARDING_ERROR_MESSAGES)
  }
  return userFacingErrorMessage(error, fallback)
}

function integrationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BrainIntegrationHttpError) {
    return userFacingCodeMessage(error.code, fallback, INTEGRATION_ERROR_MESSAGES)
  }
  return userFacingErrorMessage(error, fallback)
}
