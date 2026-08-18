import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CompanyMailboxHttpError,
  fetchCompanyMailboxMessage,
  fetchCompanyMailboxMessages,
  setCompanyMailboxMessageUnread,
  type CompanyMailboxMessage,
  type CompanyMailboxMessageSummary,
} from '../lib/brain-company-mailbox'
import { userFacingErrorMessage } from '../lib/user-facing-errors'

interface CompanyBrainInboxProps {
  organizationId: string
  address: string
  onAuthenticationRequired: () => void
  onUnreadCountChange: (count: number, capped: boolean) => void
}

export default function CompanyBrainInbox({
  organizationId,
  address,
  onAuthenticationRequired,
  onUnreadCountChange,
}: CompanyBrainInboxProps) {
  const [messages, setMessages] = useState<CompanyMailboxMessageSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<CompanyMailboxMessage | null>(null)
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadingMore, setLoadingMore] = useState(false)
  const [updatingReadState, setUpdatingReadState] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const listRequestRef = useRef<AbortController | null>(null)
  const loadMoreRequestRef = useRef<AbortController | null>(null)
  const detailRequestRef = useRef<AbortController | null>(null)
  const readStateRequestsRef = useRef(new Map<string, AbortController>())
  const messageRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const unreadOnlyButtonRef = useRef<HTMLButtonElement | null>(null)
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const unreadCountRef = useRef(0)
  const unreadCountCappedRef = useRef(false)

  const handleError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof CompanyMailboxHttpError && error.status === 401) {
      onAuthenticationRequired()
      return null
    }
    return userFacingErrorMessage(error, fallback)
  }, [onAuthenticationRequired])

  const loadMessages = useCallback(async (cursor?: string) => {
    if (!cursor) {
      listRequestRef.current?.abort()
      loadMoreRequestRef.current?.abort()
      loadMoreRequestRef.current = null
      listRequestRef.current = new AbortController()
      setLoadingMore(false)
      setListState('loading')
      setNotice(null)
    } else {
      loadMoreRequestRef.current?.abort()
      setLoadingMore(true)
    }
    const controller = cursor ? new AbortController() : listRequestRef.current!
    if (cursor) loadMoreRequestRef.current = controller
    try {
      const page = await fetchCompanyMailboxMessages(organizationId, {
        ...(cursor ? { cursor } : {}),
        limit: 40,
        ...(unreadOnly ? { unread: true } : {}),
      }, controller.signal)
      if (controller.signal.aborted) return
      setMessages((current) => cursor ? mergeMessages(current, page.messages) : page.messages)
      setNextCursor(page.nextCursor)
      unreadCountRef.current = page.unreadCount
      unreadCountCappedRef.current = page.unreadCountCapped
      onUnreadCountChange(page.unreadCount, page.unreadCountCapped)
      setListState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      const message = handleError(error, 'The company inbox could not be loaded.')
      if (message) setNotice(message)
      if (!cursor) setListState('error')
    } finally {
      if (!cursor && listRequestRef.current === controller) listRequestRef.current = null
      if (cursor && loadMoreRequestRef.current === controller) {
        loadMoreRequestRef.current = null
        setLoadingMore(false)
      }
    }
  }, [handleError, onUnreadCountChange, organizationId, unreadOnly])

  useEffect(() => {
    setMessages([])
    setSelectedId(null)
    setSelectedMessage(null)
    setDetailState('idle')
    setUpdatingReadState(false)
    void loadMessages()
    return () => {
      listRequestRef.current?.abort()
      loadMoreRequestRef.current?.abort()
      detailRequestRef.current?.abort()
      readStateRequestsRef.current.forEach((controller) => controller.abort())
      readStateRequestsRef.current.clear()
    }
  }, [loadMessages, organizationId])

  const updateUnread = useCallback(async (messageId: string, unread: boolean) => {
    if (readStateRequestsRef.current.has(messageId)) return
    const previous = messages.find((message) => message.id === messageId)?.unread
      ?? (selectedMessage?.id === messageId ? selectedMessage.unread : undefined)
    const controller = new AbortController()
    readStateRequestsRef.current.set(messageId, controller)
    setUpdatingReadState(true)
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, unread } : message))
    setSelectedMessage((current) => current?.id === messageId ? { ...current, unread } : current)
    setNotice(null)
    try {
      const updated = await setCompanyMailboxMessageUnread(organizationId, messageId, unread, controller.signal)
      if (controller.signal.aborted || readStateRequestsRef.current.get(messageId) !== controller) return
      setMessages((current) => {
        const existing = current.find((message) => message.id === messageId)
        if (!existing) return unreadOnly && updated.unread ? [updated, ...current] : current
        if (unreadOnly && !updated.unread) return current.filter((message) => message.id !== messageId)
        return current.map((message) => message.id === messageId ? { ...message, unread: updated.unread } : message)
      })
      setSelectedMessage((current) => current?.id === messageId ? { ...current, unread: updated.unread } : current)
      if (typeof previous === 'boolean' && previous !== updated.unread) {
        unreadCountRef.current = Math.max(0, unreadCountRef.current + (updated.unread ? 1 : -1))
        onUnreadCountChange(unreadCountRef.current, unreadCountCappedRef.current)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      if (typeof previous === 'boolean') {
        setMessages((current) => current.map((message) => message.id === messageId ? { ...message, unread: previous } : message))
        setSelectedMessage((current) => current?.id === messageId ? { ...current, unread: previous } : current)
      }
      const message = handleError(error, 'The email read state could not be updated.')
      if (message) setNotice(message)
    } finally {
      if (readStateRequestsRef.current.get(messageId) === controller) {
        readStateRequestsRef.current.delete(messageId)
        setUpdatingReadState(readStateRequestsRef.current.size > 0)
      }
    }
  }, [handleError, messages, onUnreadCountChange, organizationId, selectedMessage, unreadOnly])

  const openMessage = useCallback(async (message: CompanyMailboxMessageSummary) => {
    detailRequestRef.current?.abort()
    const controller = new AbortController()
    detailRequestRef.current = controller
    setSelectedId(message.id)
    setSelectedMessage(null)
    setDetailState('loading')
    setNotice(null)
    try {
      const detail = await fetchCompanyMailboxMessage(organizationId, message.id, controller.signal)
      if (controller.signal.aborted || detailRequestRef.current !== controller) return
      setSelectedMessage(detail)
      setDetailState('ready')
      if (detail.unread) void updateUnread(detail.id, false)
    } catch (error) {
      if (controller.signal.aborted || detailRequestRef.current !== controller) return
      const errorMessage = handleError(error, 'That email could not be opened.')
      if (errorMessage) setNotice(errorMessage)
      setDetailState('error')
    } finally {
      if (detailRequestRef.current === controller) detailRequestRef.current = null
    }
  }, [handleError, organizationId, updateUnread])

  const closeMessage = useCallback(() => {
    const restoreId = selectedId
    const detailRequest = detailRequestRef.current
    detailRequestRef.current = null
    detailRequest?.abort()
    setSelectedId(null)
    setSelectedMessage(null)
    setDetailState('idle')
    window.requestAnimationFrame(() => {
      const selectedRow = restoreId ? messageRowRefs.current.get(restoreId) : null
      const firstRow = messageRowRefs.current.values().next().value as HTMLButtonElement | undefined
      const focusTarget = selectedRow ?? firstRow ?? unreadOnlyButtonRef.current
      focusTarget?.focus()
    })
  }, [selectedId])

  useEffect(() => {
    if (!selectedId || !window.matchMedia('(max-width: 860px)').matches) return
    const frame = window.requestAnimationFrame(() => backButtonRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [selectedId])

  return (
    <section className={`company-inbox${selectedId ? ' has-selection' : ''}`} aria-labelledby="company-inbox-title">
      <header className="company-inbox__header">
        <div className="company-inbox__identity">
          <h1 id="company-inbox-title">
            Company Mail <sup>Inbox</sup>
          </h1>
          <p>{address}</p>
        </div>
        <div className="company-inbox__actions">
          <button ref={unreadOnlyButtonRef} type="button" className={unreadOnly ? 'is-active' : ''} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((current) => !current)}>
            Unread only
          </button>
          <button type="button" disabled={listState === 'loading'} onClick={() => void loadMessages()}>Refresh</button>
        </div>
      </header>

      {notice ? <div className="company-inbox__notice" role="alert">{notice}</div> : null}

      <div className="company-inbox__workspace">
        <section className="company-inbox__list" aria-label="Received emails">
          {listState === 'loading' ? (
            <InboxState title="Loading inbox" detail="Fetching received mail for this organization." busy />
          ) : listState === 'error' ? (
            <InboxState title="Inbox unavailable" detail="Retry when the mailbox service is available." action="Try again" onAction={() => void loadMessages()} />
          ) : messages.length === 0 ? (
            <InboxState title={unreadOnly ? 'No unread mail' : 'No mail yet'} detail={unreadOnly ? 'Every received email has been read.' : `Messages sent to ${address} will appear here.`} />
          ) : (
            <>
              <div className="company-inbox__rows">
                {messages.map((message) => (
                  <button
                    ref={(node) => {
                      if (node) messageRowRefs.current.set(message.id, node)
                      else messageRowRefs.current.delete(message.id)
                    }}
                    type="button"
                    key={message.id}
                    className={`${message.unread ? 'is-unread' : ''}${message.id === selectedId ? ' is-selected' : ''}`}
                    aria-current={message.id === selectedId ? 'true' : undefined}
                    onClick={() => void openMessage(message)}
                  >
                    <span className="company-inbox__sender">{message.sender || 'Unknown sender'}</span>
                    <span className="company-inbox__subject">{message.subject}</span>
                    <span className="company-inbox__preview">{message.preview || 'No preview available'}</span>
                    <time dateTime={message.receivedAt}>{formatMessageTime(message.receivedAt)}</time>
                    {message.attachmentCount > 0 ? <small>{message.attachmentCount} attachment{message.attachmentCount === 1 ? '' : 's'}</small> : null}
                  </button>
                ))}
              </div>
              {nextCursor ? (
                <button className="company-inbox__load-more" type="button" disabled={loadingMore} onClick={() => void loadMessages(nextCursor)}>
                  {loadingMore ? 'Loading more…' : 'Load more'}
                </button>
              ) : null}
            </>
          )}
        </section>

        <article className="company-inbox__detail" aria-live="polite">
          {selectedId ? (
            <button
              ref={backButtonRef}
              className="company-inbox__back company-inbox__back--detail"
              type="button"
              onClick={closeMessage}
            >
              Back to inbox
            </button>
          ) : null}
          {!selectedId ? (
            <InboxState title="Select an email" detail="Choose a message to read it here." />
          ) : detailState === 'loading' ? (
            <InboxState title="Opening email" detail="Loading the plain-text message." busy />
          ) : detailState === 'error' || !selectedMessage ? (
            <InboxState title="Email unavailable" detail="Choose the message again or refresh the inbox." />
          ) : (
            <>
              <header>
                <div className="company-inbox__meta">
                  <span>{selectedMessage.sender || 'Unknown sender'}</span>
                  <time dateTime={selectedMessage.receivedAt}>{formatMessageDate(selectedMessage.receivedAt)}</time>
                </div>
                <div className="company-inbox__detail-heading">
                  <div>
                    <h2>{selectedMessage.subject}</h2>
                    <p>To {selectedMessage.recipients.join(', ') || address}</p>
                  </div>
                  <button
                    className="company-inbox__read-toggle"
                    type="button"
                    disabled={updatingReadState}
                    onClick={() => void updateUnread(selectedMessage.id, !selectedMessage.unread)}
                  >
                    Mark {selectedMessage.unread ? 'read' : 'unread'}
                  </button>
                </div>
              </header>
              <div className="company-inbox__body">
                <pre>{selectedMessage.textBody || 'This email did not include a plain-text body.'}</pre>
              </div>
              {selectedMessage.attachments.length ? (
                <section className="company-inbox__attachments" aria-label="Attachments">
                  <h3>Attachments</h3>
                  {selectedMessage.attachments.map((attachment) => (
                    <div key={attachment.id}>
                      <strong>{attachment.filename}</strong>
                      <span>{attachment.contentType || 'File'}{attachment.sizeBytes === null ? '' : ` · ${formatBytes(attachment.sizeBytes)}`}</span>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  )
}

function InboxState({
  title,
  detail,
  busy = false,
  action,
  onAction,
}: {
  title: string
  detail: string
  busy?: boolean
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="company-inbox__state" role="status">
      {busy ? <span aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}
    </div>
  )
}

function mergeMessages(current: CompanyMailboxMessageSummary[], incoming: CompanyMailboxMessageSummary[]) {
  const seen = new Set(current.map((message) => message.id))
  return [...current, ...incoming.filter((message) => !seen.has(message.id))]
}

function formatMessageTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function formatMessageDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Received time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date)
}

function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}
