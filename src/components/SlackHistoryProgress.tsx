import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  CompanyOnboardingHttpError,
  fetchCurrentSlackHistorySync,
  type SlackHistorySyncRun,
} from '../lib/brain-onboarding'

const ACTIVE_POLL_INTERVAL_MS = 2_500
const TERMINAL_STATES = new Set(['cancelled', 'canceled', 'completed', 'done', 'failed', 'ready'])

interface SlackHistoryProgressProps {
  organizationId: string
  refreshToken?: number
  onAuthenticationRequired: () => void
  onVisibilityChange?: (visible: boolean) => void
}

export default function SlackHistoryProgress({
  organizationId,
  refreshToken = 0,
  onAuthenticationRequired,
  onVisibilityChange,
}: SlackHistoryProgressProps) {
  const [run, setRun] = useState<SlackHistorySyncRun | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const retryAtRef = useRef(0)

  const refresh = useCallback(async () => {
    if (inFlightRef.current || Date.now() < retryAtRef.current) return
    inFlightRef.current = true
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    try {
      const next = await fetchCurrentSlackHistorySync(controller.signal)
      if (controller.signal.aborted || requestRef.current !== controller) return
      retryAtRef.current = 0
      setRun(next)
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return
      if (error instanceof CompanyOnboardingHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (
        error instanceof CompanyOnboardingHttpError
        && error.status === 429
        && error.retryAfterMs !== undefined
      ) {
        retryAtRef.current = Date.now() + error.retryAfterMs
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      inFlightRef.current = false
    }
  }, [onAuthenticationRequired])

  useEffect(() => {
    setRun(null)
    retryAtRef.current = 0
    requestRef.current?.abort()
    void refresh()
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
      inFlightRef.current = false
    }
  }, [organizationId, refresh, refreshToken])

  const visible = isActiveSlackHistoryRun(run)

  useEffect(() => {
    onVisibilityChange?.(visible)
    return () => onVisibilityChange?.(false)
  }, [onVisibilityChange, visible])

  useEffect(() => {
    if (!visible) return undefined
    let stopped = false
    let timer: number | undefined

    const schedule = () => {
      const retryDelay = Math.max(0, retryAtRef.current - Date.now())
      timer = window.setTimeout(async () => {
        if (stopped) return
        if (document.visibilityState === 'visible') await refresh()
        if (!stopped) schedule()
      }, Math.max(ACTIVE_POLL_INTERVAL_MS, retryDelay))
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    schedule()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [refresh, visible])

  const progress = useMemo(() => slackHistoryProgress(run), [run])
  if (!run || !visible) return null

  const syncedLabel = run.syncedBackThrough
    ? `Synced back through ${formatSyncDate(run.syncedBackThrough)}`
    : 'Preparing Slack history'
  const remainingLabel = formatRemainingDays(run.estimatedDaysRemaining)
  const progressStyle = progress === null
    ? undefined
    : ({ '--slack-history-progress': `${progress}%` } as CSSProperties)

  return (
    <section
      className="slack-history-progress"
      aria-label="Slack memory sync progress"
      aria-live="polite"
    >
      <span className="slack-history-progress__spinner" aria-hidden="true" />
      <span className="slack-history-progress__copy">
        <small>Slack memory</small>
        <strong>{syncedLabel}</strong>
      </span>
      {remainingLabel ? <span className="slack-history-progress__remaining">{remainingLabel}</span> : null}
      <span
        className={`slack-history-progress__bar${progress === null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label="Slack history sync"
        {...(progress === null
          ? {}
          : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress })}
        style={progressStyle}
      >
        <i aria-hidden="true" />
      </span>
    </section>
  )
}

function isActiveSlackHistoryRun(run: SlackHistorySyncRun | null): run is SlackHistorySyncRun {
  if (!run?.syncStarted) return false
  return !TERMINAL_STATES.has(run.status.toLowerCase())
    && !TERMINAL_STATES.has(run.phase.toLowerCase())
}

function slackHistoryProgress(run: SlackHistorySyncRun | null) {
  if (!run?.estimatedMessageCount || run.estimatedMessageCount <= 0) return null
  const completed = Math.max(run.committedMessageCount, run.processedMessageCount)
  return Math.min(100, Math.max(0, Math.round((completed / run.estimatedMessageCount) * 100)))
}

function formatRemainingDays(value: number | null) {
  if (value === null) return null
  const days = Math.max(0, Math.ceil(value))
  if (days === 0) return 'Finishing now'
  return `About ${days} ${days === 1 ? 'day' : 'days'} left`
}

function formatSyncDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'recent history'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}
