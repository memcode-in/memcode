import { useEffect, useState } from 'react'

import type { CompanyMailboxSlackChannels } from '../lib/brain-company-mailbox'
import SlackMark from './SlackMark'
import './company-mailbox-slack-delivery.css'

export type CompanyMailboxSlackChannelsLoadState = 'idle' | 'loading' | 'ready' | 'error'

interface CompanyMailboxSlackDeliveryProps {
  channels: CompanyMailboxSlackChannels | null
  loadState: CompanyMailboxSlackChannelsLoadState
  enabled: boolean
  selectedChannelId: string
  currentTeamId?: string | null
  currentChannelId?: string | null
  currentChannelName?: string | null
  retryAt?: number | null
  disabled?: boolean
  compact?: boolean
  onEnabledChange: (enabled: boolean) => void
  onChannelChange: (channelId: string) => void
  onRetry: () => void
}

export default function CompanyMailboxSlackDelivery({
  channels,
  loadState,
  enabled,
  selectedChannelId,
  currentTeamId = null,
  currentChannelId = null,
  currentChannelName,
  retryAt = null,
  disabled = false,
  compact = false,
  onEnabledChange,
  onChannelChange,
  onRetry,
}: CompanyMailboxSlackDeliveryProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt === null || retryAt <= Date.now()) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    const timeout = window.setTimeout(() => setNow(Date.now()), retryAt - Date.now() + 20)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [retryAt])

  const publicChannels = channels?.channels ?? []
  const ready = loadState === 'ready' && channels?.status === 'ready' && Boolean(channels.teamId)
  const canEnable = ready && publicChannels.length > 0
  const selectedChannelIsListed = publicChannels.some((channel) => channel.id === selectedChannelId)
  const currentRouteMatchesTeam = Boolean(
    currentTeamId
    && currentChannelId
    && channels?.teamId
    && currentTeamId === channels.teamId,
  )
  const selectedChannelIsSavedFallback = Boolean(
    !selectedChannelIsListed
    && selectedChannelId
    && selectedChannelId === currentChannelId
    && currentRouteMatchesTeam,
  )
  const selectValue = selectedChannelIsListed || selectedChannelIsSavedFallback ? selectedChannelId : ''
  const teamChanged = Boolean(enabled && currentTeamId && channels?.teamId && currentTeamId !== channels.teamId)
  const retrySeconds = retryAt !== null && retryAt > now
    ? Math.max(1, Math.ceil((retryAt - now) / 1_000))
    : 0
  const statusCopy = slackDeliveryStatusCopy(loadState, channels, publicChannels.length, teamChanged, retrySeconds)

  return (
    <fieldset className={`company-mailbox-slack-delivery${compact ? ' is-compact' : ''}`}>
      <legend>Slack delivery</legend>
      <label className={`company-mailbox-slack-delivery__toggle${enabled ? ' is-enabled' : ''}`}>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled || (!enabled && !canEnable)}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span className="company-mailbox-slack-delivery__mark" aria-hidden="true"><SlackMark /></span>
        <span>
          <strong>Send new emails to Slack</strong>
          <small>Post each newly received email to one public channel.</small>
        </span>
        <i aria-hidden="true"><b /></i>
      </label>

      {enabled && ready ? (
        <label className="company-mailbox-slack-delivery__channel">
          <span>Slack channel</span>
          <select
            value={selectValue}
            disabled={disabled}
            aria-invalid={!selectedChannelIsListed}
            onChange={(event) => onChannelChange(event.target.value)}
          >
            <option value="">Choose one public channel</option>
            {selectedChannelIsSavedFallback ? (
              <option value={selectedChannelId} disabled>
                #{currentChannelName || 'Current channel'} · unavailable
              </option>
            ) : null}
            {publicChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}{channel.isMember ? ' · connected' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className={`company-mailbox-slack-delivery__status is-${statusCopy.tone}`}>
        <span role="status">{statusCopy.message}</span>
        {statusCopy.retry ? (
          <button
            type="button"
            disabled={disabled || loadState === 'loading' || retrySeconds > 0}
            onClick={onRetry}
          >
            {retrySeconds > 0 ? `Refresh in ${retrySeconds}s` : 'Refresh channels'}
          </button>
        ) : null}
      </div>

      {enabled ? (
        <p className="company-mailbox-slack-delivery__privacy">
          Sender, subject, and message text will be visible to everyone who can access the selected channel.
        </p>
      ) : null}
    </fieldset>
  )
}

function slackDeliveryStatusCopy(
  loadState: CompanyMailboxSlackChannelsLoadState,
  channels: CompanyMailboxSlackChannels | null,
  publicChannelCount: number,
  teamChanged: boolean,
  retrySeconds: number,
) {
  if (loadState === 'loading' || loadState === 'idle') {
    return { tone: 'neutral', message: 'Checking which public Slack channels can receive email.', retry: false }
  }
  if (loadState === 'error' || channels?.status === 'unavailable') {
    return {
      tone: 'warning',
      message: retrySeconds > 0
        ? 'Slack asked us to wait before checking channels again. Company Email will keep working.'
        : 'Slack channels are unavailable right now. Company Email still works, and you can connect delivery later.',
      retry: true,
    }
  }
  if (teamChanged) {
    return {
      tone: 'warning',
      message: 'The connected Slack workspace changed. Choose a public channel from this workspace.',
      retry: true,
    }
  }
  if (channels?.status === 'not_connected') {
    return {
      tone: 'neutral',
      message: 'Connect Slack later from Integrations. You can create and use Company Email without Slack delivery.',
      retry: true,
    }
  }
  if (publicChannelCount === 0) {
    return {
      tone: 'neutral',
      message: 'No public channels are available yet. Company Email can still be created now, and delivery can be added later.',
      retry: true,
    }
  }
  return {
    tone: 'ready',
    message: `${publicChannelCount} public ${publicChannelCount === 1 ? 'channel is' : 'channels are'} available for delivery.`,
    retry: true,
  }
}
