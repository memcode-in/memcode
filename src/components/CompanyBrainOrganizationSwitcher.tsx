import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  BrainOrganizationHttpError,
  createBrainOrganization,
  fetchBrainOrganizations,
  isAmbiguousBrainOrganizationFailure,
  isBrainOrganizationAuthenticationRequired,
  switchBrainOrganization,
  type BrainOrganizationSummary,
} from '../lib/brain-organizations'
import {
  ORGANIZATION_LOGO_ACCEPT,
  readOrganizationLogo,
  readOrganizationLogoFile,
  saveOrganizationLogo,
} from '../lib/organization-logo'
import { userFacingErrorMessage } from '../lib/user-facing-errors'
import AppModal from './ui/AppModal'

interface ActiveOrganization {
  id: string
  name: string
  role: BrainOrganizationSummary['role']
  owner_contact?: BrainOrganizationSummary['owner_contact']
}

interface CompanyBrainOrganizationSwitcherProps {
  activeOrganization: ActiveOrganization | null
  viewerName?: string
  demoMode: boolean
  showControl?: boolean
  createOpen?: boolean
  disabled?: boolean
  disabledReason?: string
  onAuthenticationRequired: () => void
  onActionStateChange?: (inProgress: boolean) => void
  onCreateOpenChange?: (open: boolean) => void
  onOrganizationCreated?: (organizationId: string) => Promise<unknown> | unknown
  onOrganizationChanged: (organizationId: string) => Promise<unknown>
}

type OrganizationAction = 'switch' | 'create' | null

export default function CompanyBrainOrganizationSwitcher({
  activeOrganization,
  viewerName,
  demoMode,
  showControl = true,
  createOpen: controlledCreateOpen,
  disabled = false,
  disabledReason,
  onAuthenticationRequired,
  onActionStateChange,
  onCreateOpenChange,
  onOrganizationCreated,
  onOrganizationChanged,
}: CompanyBrainOrganizationSwitcherProps) {
  const [organizations, setOrganizations] = useState<BrainOrganizationSummary[]>(() => (
    activeOrganization ? [activeOrganization] : []
  ))
  const [currentOrganizationId, setCurrentOrganizationId] = useState(activeOrganization?.id ?? '')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(demoMode ? 'ready' : 'loading')
  const [busyAction, setBusyAction] = useState<OrganizationAction>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [internalCreateOpen, setInternalCreateOpen] = useState(false)
  const [logoOpen, setLogoOpen] = useState(false)
  const [organizationLogo, setOrganizationLogo] = useState<string | null>(() => (
    readOrganizationLogo(activeOrganization?.id ?? '')
  ))
  const [draftLogo, setDraftLogo] = useState<string | null>(organizationLogo)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [logoReading, setLogoReading] = useState(false)
  const createAttempt = useRef<{ signature: string; idempotencyKey: string } | null>(null)
  const controlsLocked = demoMode || disabled || busyAction !== null
  const createOpen = controlledCreateOpen ?? internalCreateOpen

  const refreshOrganizations = useCallback(async (signal?: AbortSignal) => {
    if (demoMode) {
      setOrganizations(activeOrganization ? [activeOrganization] : [])
      setCurrentOrganizationId(activeOrganization?.id ?? '')
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    try {
      const payload = await fetchBrainOrganizations(signal)
      if (signal?.aborted) return
      setOrganizations(payload.organizations)
      setCurrentOrganizationId(payload.currentOrganizationId)
      setLoadState('ready')
      setNotice(null)
    } catch (error) {
      if (signal?.aborted) return
      if (isBrainOrganizationAuthenticationRequired(error)) {
        onAuthenticationRequired()
        return
      }
      setLoadState('error')
      setNotice(organizationErrorMessage(error, 'Your organizations could not be loaded.'))
    }
  }, [activeOrganization, demoMode, onAuthenticationRequired])

  useEffect(() => {
    const controller = new AbortController()
    void refreshOrganizations(controller.signal)
    return () => controller.abort()
  }, [refreshOrganizations])

  useEffect(() => {
    onActionStateChange?.(busyAction !== null)
    return () => {
      if (busyAction !== null) onActionStateChange?.(false)
    }
  }, [busyAction, onActionStateChange])

  const visibleOrganizations = useMemo(() => {
    if (!activeOrganization || organizations.some((organization) => organization.id === activeOrganization.id)) {
      return organizations
    }
    return [activeOrganization, ...organizations]
  }, [activeOrganization, organizations])
  const selectedOrganizationId = currentOrganizationId || activeOrganization?.id || ''
  const selectedOrganization = visibleOrganizations.find((organization) => organization.id === selectedOrganizationId)
    ?? activeOrganization
  const canEditLogo = selectedOrganization?.role === 'owner' || selectedOrganization?.role === 'admin'
  const viewerInitials = initialsFromName(viewerName || selectedOrganization?.owner_contact?.name || selectedOrganization?.name || '')

  useEffect(() => {
    setOrganizationLogo(readOrganizationLogo(selectedOrganizationId))
    setLogoOpen(false)
    setLogoError(null)
  }, [selectedOrganizationId])

  const changeCreateOpen = useCallback((open: boolean) => {
    if (!open && busyAction !== null) return
    setInternalCreateOpen(open)
    onCreateOpenChange?.(open)
    if (!open) setNotice(null)
  }, [busyAction, onCreateOpenChange])

  const openLogoEditor = useCallback(() => {
    if (!canEditLogo || disabled || busyAction !== null || !selectedOrganizationId) return
    setDraftLogo(organizationLogo)
    setLogoError(null)
    setLogoOpen(true)
  }, [busyAction, canEditLogo, disabled, organizationLogo, selectedOrganizationId])

  const changeLogoOpen = useCallback((open: boolean) => {
    if (!open && logoReading) return
    setLogoOpen(open)
    if (!open) setLogoError(null)
  }, [logoReading])

  const chooseLogo = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setLogoReading(true)
    setLogoError(null)
    try {
      setDraftLogo(await readOrganizationLogoFile(file))
    } catch (error) {
      setLogoError(userFacingErrorMessage(error, 'That image could not be read.'))
    } finally {
      input.value = ''
      setLogoReading(false)
    }
  }, [])

  const persistLogo = useCallback(() => {
    try {
      saveOrganizationLogo(selectedOrganizationId, draftLogo)
      setOrganizationLogo(draftLogo)
      setLogoOpen(false)
      setLogoError(null)
    } catch (error) {
      setLogoError(userFacingErrorMessage(error, 'This browser could not save the logo.'))
    }
  }, [draftLogo, selectedOrganizationId])

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (controlsLocked || !organizationId || organizationId === selectedOrganizationId) return
    setBusyAction('switch')
    setNotice(null)
    try {
      const organization = await switchBrainOrganization(organizationId)
      setCurrentOrganizationId(organization.id)
      setOrganizations((current) => current.map((entry) => (
        entry.id === organization.id ? { ...entry, ...organization } : entry
      )))
      await onOrganizationChanged(organization.id)
      await refreshOrganizations()
    } catch (error) {
      if (isBrainOrganizationAuthenticationRequired(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice(organizationErrorMessage(error, 'The organization could not be switched.'))
    } finally {
      setBusyAction(null)
    }
  }, [
    busyAction,
    controlsLocked,
    onAuthenticationRequired,
    onOrganizationChanged,
    refreshOrganizations,
    selectedOrganizationId,
  ])

  const createOrganization = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (controlsLocked) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const rawDomain = String(form.get('domain') || '').trim()
    if (name.length < 2 || name.length > 80) {
      setNotice('Organization name must be between 2 and 80 characters.')
      return
    }
    let domain: string | undefined
    try {
      domain = rawDomain ? normalizeDomain(rawDomain) : undefined
    } catch {
      setNotice('Enter a valid company domain, such as memcode.in.')
      return
    }

    setBusyAction('create')
    setNotice(null)
    const signature = JSON.stringify({ name, domain: domain ?? null })
    if (createAttempt.current?.signature !== signature) {
      createAttempt.current = { signature, idempotencyKey: operationKey() }
    }
    try {
      const organization = await createBrainOrganization(
        { name, ...(domain ? { domain } : {}) },
        { idempotencyKey: createAttempt.current.idempotencyKey },
      )
      createAttempt.current = null
      setOrganizations((current) => [organization, ...current.filter((entry) => entry.id !== organization.id)])
      setCurrentOrganizationId(organization.id)
      setInternalCreateOpen(false)
      onCreateOpenChange?.(false)
      await onOrganizationChanged(organization.id)
      await onOrganizationCreated?.(organization.id)
      await refreshOrganizations()
    } catch (error) {
      if (!isAmbiguousBrainOrganizationFailure(error)) createAttempt.current = null
      if (isBrainOrganizationAuthenticationRequired(error)) {
        onAuthenticationRequired()
        return
      }
      setNotice(organizationErrorMessage(error, 'The organization could not be created.', true))
    } finally {
      setBusyAction(null)
    }
  }, [
    controlsLocked,
    onAuthenticationRequired,
    onCreateOpenChange,
    onOrganizationCreated,
    onOrganizationChanged,
    refreshOrganizations,
  ])

  return (
    <>
      {showControl ? <div className="brain-organization-control">
        <div className="brain-organization-control__selector">
          <span className="brain-organization-control__avatar-shell">
            <span className="brain-organization-control__mark" aria-hidden="true">
              {organizationLogo
                ? <img src={organizationLogo} alt="" />
                : <span>{viewerInitials}</span>}
            </span>
            <button
              type="button"
              className="brain-organization-control__edit"
              aria-label="Edit organization logo"
              title={canEditLogo ? 'Edit organization logo' : 'Only organization admins and owners can edit the logo'}
              disabled={!canEditLogo || disabled || busyAction !== null || !selectedOrganizationId}
              onClick={openLogoEditor}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m4 13.7-.5 2.8 2.8-.5L15 7.3 12.7 5 4 13.7ZM11.8 5.9l2.3 2.3" />
              </svg>
            </button>
          </span>
          <label className="brain-organization-control__copy">
            <small>{busyAction === 'switch' ? 'Switching…' : 'Workspace'}</small>
            <select
              aria-label="Active Company Brain organization"
              value={selectedOrganizationId}
              disabled={controlsLocked || loadState !== 'ready' || visibleOrganizations.length < 2}
              onChange={(event) => void switchOrganization(event.target.value)}
            >
              {visibleOrganizations.length === 0 ? <option value="">No organization available</option> : null}
              {visibleOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="brain-organization-control__add"
          aria-label="Add organization"
          title="Add organization"
          disabled={controlsLocked}
          onClick={() => {
            setNotice(null)
            changeCreateOpen(true)
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          <span>New</span>
        </button>
        {notice && !createOpen ? <small className="brain-organization-control__notice" role="alert">{notice}</small> : null}
        {!notice && disabledReason ? <small className="brain-organization-control__notice brain-organization-control__notice--lock" role="status">{disabledReason}</small> : null}
      </div> : null}

      <AppModal
        open={createOpen}
        onOpenChange={changeCreateOpen}
        title="Add an organization"
        description="Create a separate Company Brain workspace. You become its owner and can invite members after setup."
        dismissible={busyAction === null}
        busy={busyAction === 'create'}
        closeLabel="Close add organization dialog"
        footer={(
          <>
            <button
              type="button"
              className="app-modal__action"
              disabled={busyAction !== null}
              onClick={() => changeCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-company-brain-organization-form"
              className="app-modal__action app-modal__action--primary"
              disabled={busyAction !== null}
            >
              {busyAction === 'create' ? 'Creating…' : 'Create organization'}
            </button>
          </>
        )}
      >
        <form
          id="create-company-brain-organization-form"
          className="brain-organization-form"
          onSubmit={createOrganization}
        >
          <label>
            <span>Organization name</span>
            <input
              data-modal-autofocus
              name="name"
              type="text"
              minLength={2}
              maxLength={80}
              autoComplete="organization"
              required
              placeholder="Acme"
            />
          </label>
          <label>
            <span>Company domain <small>Optional</small></span>
            <input
              name="domain"
              type="text"
              autoCapitalize="none"
              autoComplete="url"
              spellCheck={false}
              placeholder="acme.com"
            />
          </label>
          {notice ? <div className="brain-organization-form__error" role="alert">{notice}</div> : null}
        </form>
      </AppModal>

      <AppModal
        open={logoOpen}
        onOpenChange={changeLogoOpen}
        title="Organization logo"
        description={`Choose the logo shown beside ${selectedOrganization?.name || 'this workspace'}.`}
        size="compact"
        dismissible={!logoReading}
        busy={logoReading}
        closeLabel="Close organization logo dialog"
        footer={(
          <>
            <button
              type="button"
              className="app-modal__action"
              disabled={logoReading}
              onClick={() => changeLogoOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="app-modal__action app-modal__action--primary"
              disabled={logoReading || draftLogo === organizationLogo}
              onClick={persistLogo}
            >
              Save logo
            </button>
          </>
        )}
      >
        <div className="brain-organization-logo">
          <div className="brain-organization-logo__preview">
            <span aria-hidden="true">
              {draftLogo ? <img src={draftLogo} alt="" /> : viewerInitials}
            </span>
            <div>
              <strong>{selectedOrganization?.name || 'Organization'}</strong>
              <small>{draftLogo ? 'Custom logo selected' : 'Using your initials'}</small>
            </div>
          </div>

          <label className="brain-organization-logo__picker">
            <input
              data-modal-autofocus
              type="file"
              accept={ORGANIZATION_LOGO_ACCEPT}
              disabled={logoReading}
              onChange={(event) => void chooseLogo(event)}
            />
            <strong>{logoReading ? 'Reading image…' : draftLogo ? 'Choose a different image' : 'Choose an image'}</strong>
            <small>PNG, JPEG or WebP · up to 768 KB</small>
          </label>

          {draftLogo ? (
            <button
              type="button"
              className="brain-organization-logo__remove"
              disabled={logoReading}
              onClick={() => {
                setDraftLogo(null)
                setLogoError(null)
              }}
            >
              Remove custom logo
            </button>
          ) : null}
          <p className="brain-organization-logo__note">This logo is saved in this browser for the selected workspace.</p>
          {logoError ? <div className="brain-organization-form__error" role="alert">{logoError}</div> : null}
        </div>
      </AppModal>
    </>
  )
}

function initialsFromName(value: string) {
  const parts = value.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return 'OR'
  return `${parts[0]?.[0] || ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : parts[0]?.[1] || ''}`.toUpperCase()
}

function normalizeDomain(value: string) {
  const url = new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`)
  if (!url.hostname || url.username || url.password || url.port) throw new Error('Invalid domain')
  return url.hostname.toLowerCase().replace(/^www\./u, '')
}

function organizationErrorMessage(error: unknown, fallback: string, creating = false) {
  if (!(error instanceof BrainOrganizationHttpError)) {
    return userFacingErrorMessage(error, fallback)
  }
  if (error.status === 403) return 'You no longer have permission to access that organization.'
  if (creating && error.status === 404 && error.code === undefined) {
    return 'Creating another organization is not available yet.'
  }
  return userFacingErrorMessage(error, fallback)
}

function operationKey() {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `memcode-dashboard-create-organization-${suffix}`
}
