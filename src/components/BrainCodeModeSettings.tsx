import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import type { BrainDashboard } from '../lib/brain-dashboard'
import {
  BrainCodeModeHttpError,
  fetchBrainCodeModeSettings,
  prepareBrainCodeModeRuntime,
  updateBrainCodeModeSettings,
  type BrainCodeCredentialProvider,
  type BrainCodeModeEnvelope,
  type BrainCodeModeSettings,
  type BrainCodeProvider,
} from '../lib/brain-code-mode'
import { userFacingErrorMessage } from '../lib/user-facing-errors'

interface BrainCodeModeSettingsProps {
  dashboard: BrainDashboard
  demoMode: boolean
  onAuthenticationRequired: () => void
  onOpenPricing: () => void
}

interface CodeModeDraft {
  enabled: boolean
  provider: BrainCodeProvider
  maxTaskMinutes: string
  maxAgentTurns: string
  maxParallelAgents: string
  createPullRequests: boolean
}

const PROVIDER_OPTIONS: ReadonlyArray<{
  id: BrainCodeProvider
  label: string
  description: string
}> = [
  {
    id: 'auto',
    label: 'Automatic routing',
    description: 'Brain assigns each bounded subtask by task type and provider availability.',
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'Use Codex as the primary agent for backend, systems, and complex implementation work.',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Use Claude Code as the primary agent for interface and product implementation work.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'Use Cursor as the primary agent for repository editing and focused coding tasks.',
  },
]

const CREDENTIAL_OPTIONS: ReadonlyArray<{
  id: BrainCodeCredentialProvider
  label: string
  placeholder: string
}> = [
  { id: 'codex', label: 'OpenAI API key', placeholder: 'Paste OpenAI API key' },
  { id: 'claude', label: 'Anthropic API key', placeholder: 'Paste Anthropic API key' },
  { id: 'cursor', label: 'Cursor API key', placeholder: 'Paste Cursor API key' },
]

const RUNTIME_PREPARATION_TIMEOUT_MS = 16 * 60_000
const RUNTIME_POLL_REQUEST_TIMEOUT_MS = 15_000
const RUNTIME_POLL_INTERVAL_MS = 2_000

const DEMO_CODE_MODE: BrainCodeModeEnvelope = {
  settings: {
    enabled: false,
    provider: 'auto',
    credentials: {
      codex: { configured: true },
      claude: { configured: true },
      cursor: { configured: false },
    },
    sandbox: {
      network: 'internet',
      max_task_minutes: 45,
      max_agent_turns: 24,
      max_parallel_agents: 3,
    },
    execution_runtime: {
      configured: true,
      available: true,
      backend: 'memcode-managed',
      unavailable_reason: null,
      capabilities: {
        ephemeral_workspace: true,
        prebuilt_runtime: true,
        internet_access: true,
        restricted_egress: false,
        secret_isolation: true,
        cancellation: true,
        patch_artifact: true,
        cleanup: true,
      },
    },
    github: {
      create_pull_requests: true,
      require_approval_for_push: true,
    },
    execution_available: true,
    available_providers: ['codex', 'claude', 'cursor'],
    updated_at: '2026-08-03T09:00:00.000Z',
  },
  entitlement: {
    active: true,
    plan_id: 'company-brain-plus-monthly',
    plan_tier: 'company-brain-plus',
    code_mode_allowed: true,
    mcp_allowed: true,
  },
}

function draftFromSettings(settings: BrainCodeModeSettings): CodeModeDraft {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    maxTaskMinutes: String(settings.sandbox.max_task_minutes),
    maxAgentTurns: String(settings.sandbox.max_agent_turns),
    maxParallelAgents: String(settings.sandbox.max_parallel_agents),
    createPullRequests: settings.github.create_pull_requests,
  }
}

function credentialDraft() {
  return { codex: '', claude: '', cursor: '' } satisfies Record<BrainCodeCredentialProvider, string>
}

function removalDraft() {
  return { codex: false, claude: false, cursor: false } satisfies Record<BrainCodeCredentialProvider, boolean>
}

export default function BrainCodeModeSettings({
  dashboard,
  demoMode,
  onAuthenticationRequired,
  onOpenPricing,
}: BrainCodeModeSettingsProps) {
  const canManage = dashboard.organization.role === 'owner' || dashboard.organization.role === 'admin'
  const [envelope, setEnvelope] = useState<BrainCodeModeEnvelope | null>(demoMode && canManage ? DEMO_CODE_MODE : null)
  const [draft, setDraft] = useState<CodeModeDraft>(() => draftFromSettings(DEMO_CODE_MODE.settings))
  const [apiKeys, setApiKeys] = useState<Record<BrainCodeCredentialProvider, string>>(credentialDraft)
  const [removeCredentials, setRemoveCredentials] = useState<Record<BrainCodeCredentialProvider, boolean>>(removalDraft)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(demoMode && canManage ? 'ready' : 'loading')
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    if (!canManage) return
    if (demoMode) {
      setEnvelope(DEMO_CODE_MODE)
      setDraft(draftFromSettings(DEMO_CODE_MODE.settings))
      setLoadState('ready')
      return
    }

    setLoadState('loading')
    try {
      const nextEnvelope = await fetchBrainCodeModeSettings(signal, dashboard.organization.id)
      if (signal?.aborted) return
      setEnvelope(nextEnvelope)
      setDraft(draftFromSettings(nextEnvelope.settings))
      setApiKeys(credentialDraft())
      setRemoveCredentials(removalDraft())
      setNotice(null)
      setLoadState('ready')
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      if (error instanceof BrainCodeModeHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'Code Mode settings are unavailable.'),
      })
      setLoadState('error')
    }
  }, [canManage, dashboard.organization.id, demoMode, onAuthenticationRequired])

  useEffect(() => {
    if (!canManage) return undefined
    const controller = new AbortController()
    void loadSettings(controller.signal)
    return () => controller.abort()
  }, [canManage, loadSettings])

  useEffect(() => () => saveControllerRef.current?.abort(), [])

  useEffect(() => {
    saveControllerRef.current?.abort()
    saveControllerRef.current = null
    setPreparing(false)
    setSaving(false)
  }, [dashboard.organization.id])

  if (!canManage) {
    return (
      <section className="brain-runtime-settings brain-runtime-settings--state" aria-labelledby="brain-code-mode-access-title">
        <h1 id="brain-code-mode-access-title">Code Mode is managed by your organization.</h1>
        <p>An organization admin or owner can configure coding providers, workspace limits and GitHub policies.</p>
      </section>
    )
  }

  if (loadState === 'loading') {
    return <section className="brain-runtime-settings brain-runtime-settings--state" role="status">Loading Code Mode…</section>
  }

  if (loadState === 'error' || !envelope) {
    return (
      <section className="brain-runtime-settings brain-runtime-settings--state" aria-labelledby="brain-code-mode-error-title">
        <h1 id="brain-code-mode-error-title">Code Mode is unavailable.</h1>
        <p>{notice?.message ?? 'Code Mode settings are temporarily unavailable. Please try again.'}</p>
        <button type="button" onClick={() => void loadSettings()}>Try again</button>
      </section>
    )
  }

  if (!envelope.entitlement.code_mode_allowed) {
    return (
      <section className="brain-runtime-settings brain-runtime-settings--state" aria-labelledby="brain-code-mode-plan-title">
        <h1 id="brain-code-mode-plan-title">Activate Company Brain to use Code Mode.</h1>
        <p>Code Mode provisions an isolated coding workspace and delegates bounded tasks to your configured providers.</p>
        <button type="button" onClick={onOpenPricing}>View Company Brain plans</button>
      </section>
    )
  }

  const { settings } = envelope
  const currentProvider = PROVIDER_OPTIONS.find((option) => option.id === settings.provider) ?? PROVIDER_OPTIONS[0]
  const runtimeCanBePrepared = settings.execution_runtime.unavailable_reason === 'runtime_preparation_required'
  const providerIsAvailable = (provider: BrainCodeProvider) => provider === 'auto'
    ? runtimeCanBePrepared || settings.available_providers.length > 0
    : runtimeCanBePrepared || settings.available_providers.includes(provider)
  const managedExecutionAvailable = settings.execution_runtime.available
  const selectedProviderConfigured = settings.provider === 'auto'
    ? settings.available_providers.some((provider) => settings.credentials[provider].configured)
    : settings.credentials[settings.provider].configured
  const executionStatus = settings.execution_available
    ? 'Managed execution ready'
    : runtimeCanBePrepared
      ? 'Prepared when enabled'
    : managedExecutionAvailable && !selectedProviderConfigured
      ? 'Provider setup required'
      : 'Managed execution unavailable'
  const formDisabled = saving

  const setCredential = (provider: BrainCodeCredentialProvider, value: string) => {
    setApiKeys((current) => ({ ...current, [provider]: value }))
    if (value) setRemoveCredentials((current) => ({ ...current, [provider]: false }))
    setNotice(null)
  }

  const toggleCredentialRemoval = (provider: BrainCodeCredentialProvider) => {
    setRemoveCredentials((current) => ({ ...current, [provider]: !current[provider] }))
    setApiKeys((current) => ({ ...current, [provider]: '' }))
    setNotice(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const maxTaskMinutes = parseBoundedInteger(draft.maxTaskMinutes, 5, 120)
    const maxAgentTurns = parseBoundedInteger(draft.maxAgentTurns, 1, 64)
    const maxParallelAgents = parseBoundedInteger(draft.maxParallelAgents, 1, 4)
    if (!maxTaskMinutes || !maxAgentTurns || !maxParallelAgents) {
      setNotice({ tone: 'error', message: 'Use positive whole numbers for every workspace limit.' })
      return
    }
    if (draft.enabled && !providerIsAvailable(draft.provider)) {
      setNotice({ tone: 'error', message: 'Choose a coding provider available to this organization.' })
      return
    }
    const credentialWillRemain = (provider: BrainCodeCredentialProvider) => (
      Boolean(apiKeys[provider].trim())
      || (settings.credentials[provider].configured && !removeCredentials[provider])
    )
    const supportedCredentialProviders = runtimeCanBePrepared
      ? CREDENTIAL_OPTIONS.map(({ id }) => id)
      : settings.available_providers
    const providerWillBeReady = draft.provider === 'auto'
      ? supportedCredentialProviders.some(credentialWillRemain)
      : credentialWillRemain(draft.provider)
    if (draft.enabled && !providerWillBeReady) {
      setNotice({ tone: 'error', message: 'Add a key for an available provider before enabling Code Mode.' })
      return
    }

    const credentials: Partial<Record<BrainCodeCredentialProvider, { api_key?: string; remove?: boolean }>> = {}
    for (const { id } of CREDENTIAL_OPTIONS) {
      const key = apiKeys[id].trim()
      if (key) credentials[id] = { api_key: key }
      else if (removeCredentials[id]) credentials[id] = { remove: true }
    }

    const controller = new AbortController()
    const organizationId = dashboard.organization.id
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setSaving(true)
    setNotice(null)
    try {
      const input = {
        enabled: draft.enabled,
        provider: draft.provider,
        ...(Object.keys(credentials).length ? { credentials } : {}),
        sandbox: {
          max_task_minutes: maxTaskMinutes,
          max_agent_turns: maxAgentTurns,
          max_parallel_agents: maxParallelAgents,
        },
        github: {
          create_pull_requests: draft.createPullRequests,
          require_approval_for_push: true,
        },
      }
      let nextEnvelope: BrainCodeModeEnvelope
      if (demoMode) {
        nextEnvelope = previewEnvelope(envelope, input, apiKeys, removeCredentials)
      } else {
        if (draft.enabled && runtimeCanBePrepared) {
          setPreparing(true)
          setNotice({
            tone: 'success',
            message: 'Preparing the managed coding workspace. This continues safely in the background.',
          })
          await prepareBrainCodeModeRuntime(controller.signal, organizationId)
          await waitForPreparedRuntime(controller.signal, organizationId)
        }
        nextEnvelope = await updateBrainCodeModeSettings(input, controller.signal, organizationId)
      }
      setEnvelope(nextEnvelope)
      setDraft(draftFromSettings(nextEnvelope.settings))
      setApiKeys(credentialDraft())
      setRemoveCredentials(removalDraft())
      setNotice({
        tone: 'success',
        message: demoMode
          ? 'Code Mode preview updated for this demo session.'
          : draft.enabled && runtimeCanBePrepared
            ? 'Code Mode runtime prepared and enabled for new coding tasks.'
            : 'Code Mode settings saved for new coding tasks.',
      })
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof BrainCodeModeHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'Code Mode settings could not be saved.'),
      })
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null
      if (!controller.signal.aborted) {
        setPreparing(false)
        setSaving(false)
      }
    }
  }

  return (
    <form className="brain-runtime-settings brain-code-mode-settings" onSubmit={(event) => void submit(event)}>
      <header className="brain-runtime-settings__header">
        <div>
          <h1>Code Mode.</h1>
          <p>Brain plans the work. Isolated coding agents implement, test and prepare a reviewable patch.</p>
        </div>
        <div className="brain-runtime-settings__status" aria-label="Current Code Mode configuration">
          <span>{executionStatus}</span>
          <strong>{settings.enabled ? 'Code Mode on' : 'Code Mode off'}</strong>
          <small>{currentProvider.label}</small>
        </div>
      </header>

      {!managedExecutionAvailable ? (
        <div className={`brain-runtime-settings__notice ${runtimeCanBePrepared ? '' : 'is-error'}`} role="status">
          {executionUnavailableMessage(settings)}
        </div>
      ) : null}
      {notice ? (
        <div className={`brain-runtime-settings__notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </div>
      ) : null}

      <div className="brain-runtime-settings__configuration">
        <section className="brain-runtime-settings__column" aria-labelledby="brain-code-provider-title">
          <div className="brain-runtime-settings__section-heading">
            <span>01</span>
            <div><h2 id="brain-code-provider-title">Coding agent</h2><p>Choose one provider or let Brain route each subtask.</p></div>
          </div>

          <div className="brain-runtime-settings__tool-list brain-code-mode-settings__master">
            <label className={draft.enabled ? 'is-enabled' : ''}>
              <span><strong>Enable Code Mode</strong><small>Only the dedicated coding prompt and coding tool policy are used.</small></span>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={formDisabled || (!managedExecutionAvailable && !runtimeCanBePrepared && !draft.enabled)}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <i aria-hidden="true"><b /></i>
            </label>
          </div>

          <fieldset className="brain-runtime-settings__provider-list" disabled={formDisabled}>
            <legend className="sr-only">Code Mode provider</legend>
            {PROVIDER_OPTIONS.map((option) => {
              const available = providerIsAvailable(option.id)
              return (
                <label key={option.id} className={draft.provider === option.id ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="code-mode-provider"
                    value={option.id}
                    checked={draft.provider === option.id}
                    disabled={!available}
                    onChange={() => {
                      setDraft((current) => ({ ...current, provider: option.id }))
                      setNotice(null)
                    }}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{available ? option.description : 'This provider is not available for managed Code Mode execution.'}</small>
                  </span>
                  <i aria-hidden="true" />
                </label>
              )
            })}
          </fieldset>
        </section>

        <section className="brain-runtime-settings__column" aria-labelledby="brain-code-credentials-title">
          <div className="brain-runtime-settings__section-heading">
            <span>02</span>
            <div><h2 id="brain-code-credentials-title">Provider access</h2><p>Keys are stored by Company Brain and never shown again.</p></div>
          </div>

          <div className="brain-code-mode-settings__credentials">
            {CREDENTIAL_OPTIONS.map((option) => {
              const configured = settings.credentials[option.id].configured && !removeCredentials[option.id]
              return (
                <label className="brain-runtime-settings__field" key={option.id}>
                  <span>{option.label}<em>{configured ? 'Configured' : removeCredentials[option.id] ? 'Removal staged' : 'Not configured'}</em></span>
                  <div className="brain-code-mode-settings__key">
                    <input
                      type="password"
                      value={apiKeys[option.id]}
                      disabled={formDisabled || removeCredentials[option.id]}
                      placeholder={configured ? 'Key saved · enter to replace' : option.placeholder}
                      autoComplete="new-password"
                      spellCheck={false}
                      onChange={(event) => setCredential(option.id, event.target.value)}
                    />
                    {settings.credentials[option.id].configured ? (
                      <button
                        type="button"
                        className={removeCredentials[option.id] ? 'is-staged' : ''}
                        disabled={formDisabled}
                        onClick={() => toggleCredentialRemoval(option.id)}
                      >{removeCredentials[option.id] ? 'Keep key' : 'Remove'}</button>
                    ) : null}
                  </div>
                  <small>{apiKeys[option.id] ? 'The replacement is sent only when you save.' : 'Kept outside the coding workspace.'}</small>
                </label>
              )
            })}
          </div>
        </section>
      </div>

      <div className="brain-runtime-settings__configuration brain-code-mode-settings__policies">
        <section className="brain-runtime-settings__column" aria-labelledby="brain-code-sandbox-title">
          <div className="brain-runtime-settings__section-heading">
            <span>03</span>
            <div><h2 id="brain-code-sandbox-title">Managed workspace</h2><p>Every coding task runs in an isolated workspace managed by MemCode.</p></div>
          </div>

          <div className="brain-runtime-settings__tool-list">
            <div className="brain-runtime-settings__tool-readout">
              <span><strong>Network</strong><small>Internet access for repositories, dependencies and development APIs. Provider access is task-scoped; keys stay in Company Brain.</small></span>
              <em>{settings.sandbox.network === 'internet' ? 'Internet' : 'Restricted'}</em>
            </div>
          </div>
          <div className="brain-code-mode-settings__limits">
            <label className="brain-runtime-settings__field">
              <span>Task minutes</span>
              <input type="number" min="5" max="120" step="1" value={draft.maxTaskMinutes} disabled={formDisabled} onChange={(event) => setDraft((current) => ({ ...current, maxTaskMinutes: event.target.value }))} />
            </label>
            <label className="brain-runtime-settings__field">
              <span>Agent turns</span>
              <input type="number" min="1" max="64" step="1" value={draft.maxAgentTurns} disabled={formDisabled} onChange={(event) => setDraft((current) => ({ ...current, maxAgentTurns: event.target.value }))} />
            </label>
            <label className="brain-runtime-settings__field">
              <span>Parallel agents</span>
              <input type="number" min="1" max="4" step="1" value={draft.maxParallelAgents} disabled={formDisabled} onChange={(event) => setDraft((current) => ({ ...current, maxParallelAgents: event.target.value }))} />
            </label>
          </div>
        </section>

        <section className="brain-runtime-settings__column" aria-labelledby="brain-code-github-title">
          <div className="brain-runtime-settings__section-heading">
            <span>04</span>
            <div><h2 id="brain-code-github-title">GitHub workflow</h2><p>Control what happens after implementation and verification.</p></div>
          </div>
          <div className="brain-runtime-settings__tool-list">
            <label className={draft.createPullRequests ? 'is-enabled' : ''}>
              <span><strong>Allow pull request delivery</strong><small>Tasks stay patch-only unless the requester explicitly asks Code Mode to open a pull request.</small></span>
              <input type="checkbox" checked={draft.createPullRequests} disabled={formDisabled} onChange={(event) => setDraft((current) => ({ ...current, createPullRequests: event.target.checked }))} />
              <i aria-hidden="true"><b /></i>
            </label>
            <label className="is-enabled">
              <span><strong>Approval before push</strong><small>Require organization admin or owner approval before any branch is pushed externally.</small></span>
              <input type="checkbox" checked disabled aria-describedby="brain-code-push-approval-note" />
              <i aria-hidden="true"><b /></i>
            </label>
            <p id="brain-code-push-approval-note" className="brain-code-mode-settings__policy-note">This safety policy is always enforced and cannot be disabled.</p>
            <div className="brain-runtime-settings__tool-readout">
              <span><strong>GitHub publishing</strong><small>Publishing requires a scoped GitHub repository installation; until then, Code Mode only preserves the reviewable patch.</small></span>
              <em>Approval gated</em>
            </div>
          </div>
        </section>
      </div>

      <footer className="brain-runtime-settings__footer">
        <span>{demoMode ? 'Preview changes stay in this demo session.' : settings.updated_at ? `Last saved ${formatDate(settings.updated_at)}.` : 'Not changed yet.'}</span>
        <button type="submit" disabled={saving}>{preparing ? 'Preparing runtime…' : saving ? 'Saving…' : demoMode ? 'Update preview' : 'Save Code Mode'}</button>
      </footer>
    </form>
  )
}

async function waitForPreparedRuntime(
  signal: AbortSignal,
  organizationId: string,
): Promise<BrainCodeModeEnvelope> {
  const deadline = Date.now() + RUNTIME_PREPARATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const request = linkedTimeoutSignal(signal, RUNTIME_POLL_REQUEST_TIMEOUT_MS)
    try {
      const envelope = await fetchBrainCodeModeSettings(request.signal, organizationId)
      if (envelope.settings.execution_runtime.available) return envelope
      const reason = envelope.settings.execution_runtime.unavailable_reason
      if (
        reason === 'managed_execution_not_configured'
        || reason === 'credential_isolation_unavailable'
        || reason === 'provider_adapter_unavailable'
      ) {
        throw new BrainCodeModeHttpError(
          executionUnavailableMessage(envelope.settings),
          503,
          reason,
        )
      }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof BrainCodeModeHttpError) {
        if (
          error.code === 'managed_execution_not_configured'
          || error.code === 'credential_isolation_unavailable'
          || error.code === 'provider_adapter_unavailable'
          || (error.status < 500 && error.status !== 429)
        ) throw error
      } else if (!(error instanceof DOMException) && !(error instanceof TypeError)) {
        throw error
      }
      // A readiness request may time out while the durable image build keeps
      // running. The next poll checks the worker's eventual result.
    } finally {
      request.dispose()
    }
    await abortableDelay(RUNTIME_POLL_INTERVAL_MS, signal)
  }
  throw new BrainCodeModeHttpError(
    'Workspace preparation is still running. Return to Code Mode in a few minutes and save again.',
    503,
    'runtime_preparation_required',
  )
}

function linkedTimeoutSignal(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parent.reason)
  parent.addEventListener('abort', abortFromParent, { once: true })
  const timeout = window.setTimeout(() => {
    controller.abort(new DOMException('Code Mode readiness check timed out.', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timeout)
      parent.removeEventListener('abort', abortFromParent)
    },
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function executionUnavailableMessage(settings: BrainCodeModeSettings): string {
  switch (settings.execution_runtime.unavailable_reason) {
    case 'runtime_preparation_required':
      return 'Your isolated coding runtime will be prepared automatically when you enable Code Mode.'
    case 'credential_isolation_unavailable':
      return 'The selected sandbox is connected, but secure provider-key isolation is unavailable. Code Mode stays off until that capability is ready.'
    case 'provider_adapter_unavailable':
      return 'The selected sandbox is connected, but no coding-agent adapter is available. Code Mode stays off until an adapter is ready.'
    case 'managed_execution_not_configured':
    default:
      return 'The regular Brain sandbox may be connected, but this deployment has no compatible Code Mode execution adapter yet.'
  }
}

function parseBoundedInteger(value: string, minimum: number, maximum: number) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

function previewEnvelope(
  current: BrainCodeModeEnvelope,
  input: Parameters<typeof updateBrainCodeModeSettings>[0],
  apiKeys: Record<BrainCodeCredentialProvider, string>,
  removals: Record<BrainCodeCredentialProvider, boolean>,
): BrainCodeModeEnvelope {
  return {
    entitlement: current.entitlement,
    settings: {
      ...current.settings,
      enabled: input.enabled,
      provider: input.provider,
      credentials: {
        codex: { configured: removals.codex ? false : current.settings.credentials.codex.configured || Boolean(apiKeys.codex.trim()) },
        claude: { configured: removals.claude ? false : current.settings.credentials.claude.configured || Boolean(apiKeys.claude.trim()) },
        cursor: { configured: removals.cursor ? false : current.settings.credentials.cursor.configured || Boolean(apiKeys.cursor.trim()) },
      },
      sandbox: { ...current.settings.sandbox, ...input.sandbox },
      github: input.github,
      updated_at: new Date().toISOString(),
    },
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
