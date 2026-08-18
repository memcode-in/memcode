import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  brainBillingPeriodDaysRemaining,
  brainSubscriptionContinuityPhase,
  canViewBrainUsage,
  type BrainDashboard,
} from '../lib/brain-dashboard'
import BrainByokSpend from './BrainByokSpend'
import {
  BrainRuntimeSettingsHttpError,
  fetchBrainRuntimeSettings,
  updateBrainRuntimeSettings,
  type BrainModelCredentialProvider,
  type BrainModelProvider,
  type BrainRuntimeSettings,
  type BrainSandboxCredentialProvider,
  type BrainSandboxProvider,
  type BrainWebReaderCredentialProvider,
  type BrainWebSearchCredentialProvider,
  type RuntimeCredentialUpdate,
} from '../lib/brain-runtime-settings'
import {
  managedWebCreditUsageLabel,
  nativeModelWebAvailable,
  webAccessProviderFromRuntime,
  webAccessRuntimeProviders,
  webRuntimeSubmissionError,
  type BrainWebAccessProvider,
  type WebRuntimePolicyInput,
} from '../lib/brain-runtime-policy'
import { userFacingErrorMessage } from '../lib/user-facing-errors'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion'
import './brain-runtime-settings.css'

interface BrainRuntimeSettingsProps {
  dashboard: BrainDashboard
  demoMode: boolean
  onAuthenticationRequired: () => void
}

interface RuntimeDraft {
  modelProvider: BrainModelProvider
  modelIds: Record<BrainModelProvider, string>
  webAccessProvider: BrainWebAccessProvider
  sandboxProvider: BrainSandboxProvider
  daytonaTarget: string
  blaxelWorkspace: string
  cloudflareBridgeUrl: string
}

interface ProviderOption<T extends string> {
  id: T
  label: string
  description: string
}

type ModelProviderOption = ProviderOption<BrainModelProvider> & { defaultModel: string }
type AlternativeModelProviderOption = ModelProviderOption & { id: BrainModelCredentialProvider }

interface CredentialDrafts {
  modelKeys: Record<BrainModelCredentialProvider, string>
  modelRemovals: Record<BrainModelCredentialProvider, boolean>
  webSearchKeys: Record<BrainWebSearchCredentialProvider, string>
  webSearchRemovals: Record<BrainWebSearchCredentialProvider, boolean>
  webReaderKeys: Record<BrainWebReaderCredentialProvider, string>
  webReaderRemovals: Record<BrainWebReaderCredentialProvider, boolean>
  sandboxKeys: Record<BrainSandboxCredentialProvider, string>
  sandboxRemovals: Record<BrainSandboxCredentialProvider, boolean>
}

interface RuntimeContinuityNotice {
  tone: 'ready' | 'action'
  title: string
  message: string
}

const MODEL_PROVIDERS: ReadonlyArray<ModelProviderOption> = [
  {
    id: 'managed',
    label: 'MemCode managed',
    description: 'Use the maintained model and credentials included with your plan.',
    defaultModel: 'MemCode managed model',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Run the main Brain harness with your OpenAI account.',
    defaultModel: 'gpt-5-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    description: 'Use a Claude model and your Anthropic API key.',
    defaultModel: 'claude-sonnet-5',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Use a Gemini model through the Google AI API.',
    defaultModel: 'gemini-3.6-flash',
  },
  {
    id: 'ai-gateway',
    label: 'Vercel AI Gateway',
    description: 'Route a provider/model identifier through Vercel AI Gateway.',
    defaultModel: 'provider/model',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Choose from OpenRouter models with one organization key.',
    defaultModel: 'openai/gpt-5-mini',
  },
  {
    id: 'vertex-ai',
    label: 'Vertex AI',
    description: 'Run Gemini through Vertex AI Express Mode with your API key.',
    defaultModel: 'gemini-2.5-flash',
  },
]

const PRIMARY_MODEL_PROVIDERS = MODEL_PROVIDERS.filter((option) => (
  option.id === 'managed'
  || option.id === 'openai'
  || option.id === 'anthropic'
  || option.id === 'google'
))

const ALTERNATIVE_MODEL_PROVIDERS = MODEL_PROVIDERS.filter((option): option is AlternativeModelProviderOption => (
  option.id === 'ai-gateway'
  || option.id === 'openrouter'
  || option.id === 'vertex-ai'
))

const WEB_ACCESS_PROVIDERS: ReadonlyArray<ProviderOption<BrainWebAccessProvider>> = [
  {
    id: 'managed',
    label: 'MemCode managed',
    description: 'Use plan Firecrawl credits first, then provider-native web automatically when supported.',
  },
  {
    id: 'native',
    label: 'Native model web',
    description: 'Use only the selected model provider\'s native web search through global billing usage.',
  },
  {
    id: 'firecrawl',
    label: 'Your Firecrawl key',
    description: 'Use your Firecrawl account for delegated search, crawl, scrape, and interaction tools.',
  },
  {
    id: 'tavily',
    label: 'Your Tavily key',
    description: 'Use Tavily search without drawing from the managed Firecrawl credit pool.',
  },
  {
    id: 'scrape-do',
    label: 'Your Scrape.do key',
    description: 'Use Scrape.do for direct public-page reading without managed credits.',
  },
  {
    id: 'disabled',
    label: 'Disable web',
    description: 'Expose no delegated or provider-native public-web tools to the Brain.',
  },
]

const SANDBOX_PROVIDERS: ReadonlyArray<ProviderOption<BrainSandboxProvider>> = [
  {
    id: 'managed',
    label: 'MemCode managed',
    description: 'Use the isolated runtime managed for your organization.',
  },
  {
    id: 'daytona',
    label: 'Daytona',
    description: 'Run isolated work in your own Daytona environment.',
  },
  {
    id: 'blaxel',
    label: 'Blaxel',
    description: 'Run bounded, network-isolated tasks in your Blaxel workspace.',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Sandbox',
    description: 'Run persistent tasks through your Cloudflare Sandbox Bridge.',
  },
  {
    id: 'disabled',
    label: 'No sandbox',
    description: 'Prevent the Brain from running isolated code tasks.',
  },
]

const MODEL_CREDENTIAL_PROVIDERS: readonly BrainModelCredentialProvider[] = [
  'openai',
  'anthropic',
  'google',
  'ai-gateway',
  'openrouter',
  'vertex-ai',
]
const WEB_SEARCH_CREDENTIAL_PROVIDERS: readonly BrainWebSearchCredentialProvider[] = ['tavily']
const WEB_READER_CREDENTIAL_PROVIDERS: readonly BrainWebReaderCredentialProvider[] = ['firecrawl', 'scrape-do']
const SANDBOX_CREDENTIAL_PROVIDERS: readonly BrainSandboxCredentialProvider[] = ['daytona', 'blaxel', 'cloudflare']

const DEMO_RUNTIME_SETTINGS: BrainRuntimeSettings = {
  model: {
    provider: 'managed',
    model_id: 'MemCode managed model',
    api_key_configured: false,
    credentials: {
      openai: { api_key_configured: true },
      anthropic: { api_key_configured: true },
      google: { api_key_configured: true },
      'ai-gateway': { api_key_configured: true },
      openrouter: { api_key_configured: true },
      'vertex-ai': { api_key_configured: true },
    },
  },
  tools: {
    web_search_enabled: true,
    managed_web_search_available: true,
    web_search: {
      provider: 'tavily',
      managed_available: true,
      credentials: {
        tavily: { api_key_configured: true },
      },
    },
    firecrawl: {
      enabled: true,
      api_key_configured: true,
    },
    web_reader: {
      provider: 'firecrawl',
      managed_available: true,
      credentials: {
        firecrawl: { api_key_configured: true },
        'scrape-do': { api_key_configured: true },
      },
    },
    sandbox: {
      provider: 'managed',
      managed_available: true,
      credentials: {
        daytona: { api_key_configured: true },
        blaxel: { api_key_configured: true },
        cloudflare: { api_key_configured: true },
      },
      daytona_target: 'default-target',
      blaxel_workspace: 'memcode-demo',
      cloudflare_bridge_url: 'https://cloudflare-sandbox-bridge.demo.workers.dev',
    },
    browser: {
      enabled: true,
      code_mode_enabled: true,
      managed_available: true,
      api_key_configured: true,
      custom_api_key_configured: false,
      max_cost_usd: 0.25,
      max_task_seconds: 120,
    },
    x: {
      read_enabled: true,
      bearer_configured: true,
    },
  },
  updated_at: '2026-08-03T09:00:00.000Z',
}

function defaultModelIds(): Record<BrainModelProvider, string> {
  return {
    managed: 'MemCode managed model',
    openai: 'gpt-5-mini',
    anthropic: 'claude-sonnet-5',
    google: 'gemini-3.6-flash',
    'ai-gateway': 'provider/model',
    openrouter: 'openai/gpt-5-mini',
    'vertex-ai': 'gemini-2.5-flash',
  }
}

function draftFromSettings(settings: BrainRuntimeSettings): RuntimeDraft {
  const modelIds = defaultModelIds()
  modelIds[settings.model.provider] = settings.model.model_id
  return {
    modelProvider: settings.model.provider,
    modelIds,
    webAccessProvider: webAccessProviderFromRuntime(
      settings.tools.web_search.provider,
      settings.tools.web_reader.provider,
    ),
    sandboxProvider: settings.tools.sandbox.provider,
    daytonaTarget: settings.tools.sandbox.daytona_target ?? '',
    blaxelWorkspace: settings.tools.sandbox.blaxel_workspace ?? '',
    cloudflareBridgeUrl: settings.tools.sandbox.cloudflare_bridge_url ?? '',
  }
}

function emptyModelKeys(): Record<BrainModelCredentialProvider, string> {
  return { openai: '', anthropic: '', google: '', 'ai-gateway': '', openrouter: '', 'vertex-ai': '' }
}

function emptyModelRemovals(): Record<BrainModelCredentialProvider, boolean> {
  return {
    openai: false,
    anthropic: false,
    google: false,
    'ai-gateway': false,
    openrouter: false,
    'vertex-ai': false,
  }
}

function emptyWebSearchKeys(): Record<BrainWebSearchCredentialProvider, string> {
  return { tavily: '' }
}

function emptyWebSearchRemovals(): Record<BrainWebSearchCredentialProvider, boolean> {
  return { tavily: false }
}

function emptyWebReaderKeys(): Record<BrainWebReaderCredentialProvider, string> {
  return { firecrawl: '', 'scrape-do': '' }
}

function emptyWebReaderRemovals(): Record<BrainWebReaderCredentialProvider, boolean> {
  return { firecrawl: false, 'scrape-do': false }
}

function emptySandboxKeys(): Record<BrainSandboxCredentialProvider, string> {
  return { daytona: '', blaxel: '', cloudflare: '' }
}

function emptySandboxRemovals(): Record<BrainSandboxCredentialProvider, boolean> {
  return { daytona: false, blaxel: false, cloudflare: false }
}

function ProviderChoice({
  value,
  label,
  description,
  status,
  selected,
  disabled,
  selectionRole = 'choice',
  onSelect,
  children,
}: {
  value: string
  label: string
  description: string
  status: string
  selected: boolean
  disabled: boolean
  selectionRole?: 'choice' | 'switch'
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <AccordionItem value={value} className={`brain-runtime-provider${selected ? ' is-selected' : ''}`}>
      <div className="brain-runtime-provider__row">
        <AccordionTrigger className="brain-runtime-provider__trigger">
          <span className="brain-runtime-provider__copy">
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
          <span className="brain-runtime-provider__status">{status}</span>
        </AccordionTrigger>
        <button
          type="button"
          className="brain-runtime-provider__select"
          {...(selectionRole === 'switch'
            ? { role: 'switch', 'aria-checked': selected }
            : { 'aria-pressed': selected })}
          aria-label={selectionRole === 'switch' ? `${selected ? 'Disable' : 'Enable'} ${label}` : `Use ${label}`}
          disabled={disabled}
          onClick={onSelect}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <AccordionContent className="brain-runtime-provider__content">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}

function AlternativeModelDisclosure({
  expanded,
  onToggle,
}: {
  expanded: boolean
  onToggle: () => void
}) {
  const providers = [
    { mark: 'V', label: 'Vercel AI Gateway' },
    { mark: 'O', label: 'OpenRouter' },
    { mark: 'V', label: 'Vertex AI' },
  ] as const

  return (
    <button
      type="button"
      className="brain-runtime-model-disclosure"
      aria-expanded={expanded}
      aria-controls="brain-runtime-alternative-models"
      onClick={onToggle}
    >
      <span className="brain-runtime-model-disclosure__marks" aria-hidden="true">
        {providers.map((provider) => <i key={provider.label}>{provider.mark}</i>)}
      </span>
      <span className="brain-runtime-model-disclosure__copy">
        See Vercel, OpenRouter, and Vertex AI
      </span>
      <svg
        className="brain-runtime-model-disclosure__chevron"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>
  )
}

function SecretField({
  id,
  label,
  value,
  placeholder,
  configured,
  removalStaged,
  disabled,
  onChange,
  onToggleRemoval,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  configured: boolean
  removalStaged: boolean
  disabled: boolean
  onChange: (value: string) => void
  onToggleRemoval: () => void
}) {
  const status = value.trim()
    ? configured ? 'Replacement staged' : 'Ready to save'
    : removalStaged ? 'Removal staged' : configured ? 'Key saved' : 'Not configured'
  return (
    <div className="brain-runtime-settings__field brain-runtime-provider__field">
      <span><label htmlFor={id}>{label}</label><em>{status}</em></span>
      <div className="brain-runtime-provider__secret">
        <input
          id={id}
          type="password"
          value={value}
          disabled={disabled || removalStaged}
          placeholder={configured ? 'Key saved · enter to replace' : placeholder}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {configured ? (
          <button
            type="button"
            className={removalStaged ? 'is-staged' : ''}
            disabled={disabled}
            onClick={onToggleRemoval}
          >{removalStaged ? 'Keep key' : 'Remove'}</button>
        ) : null}
      </div>
      <small>{value ? 'The replacement is sent only when you save.' : 'The saved secret is never shown again.'}</small>
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  placeholder,
  help,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  help: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="brain-runtime-settings__field brain-runtime-provider__field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{help}</small>
    </label>
  )
}

export default function BrainRuntimeSettings({
  dashboard,
  demoMode,
  onAuthenticationRequired,
}: BrainRuntimeSettingsProps) {
  const [settings, setSettings] = useState<BrainRuntimeSettings | null>(demoMode ? DEMO_RUNTIME_SETTINGS : null)
  const [draft, setDraft] = useState<RuntimeDraft>(() => draftFromSettings(DEMO_RUNTIME_SETTINGS))
  const [alternativeModelsExpanded, setAlternativeModelsExpanded] = useState(false)
  const [modelKeys, setModelKeys] = useState(emptyModelKeys)
  const [modelRemovals, setModelRemovals] = useState(emptyModelRemovals)
  const [webSearchKeys, setWebSearchKeys] = useState(emptyWebSearchKeys)
  const [webSearchRemovals, setWebSearchRemovals] = useState(emptyWebSearchRemovals)
  const [webReaderKeys, setWebReaderKeys] = useState(emptyWebReaderKeys)
  const [webReaderRemovals, setWebReaderRemovals] = useState(emptyWebReaderRemovals)
  const [sandboxKeys, setSandboxKeys] = useState(emptySandboxKeys)
  const [sandboxRemovals, setSandboxRemovals] = useState(emptySandboxRemovals)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(demoMode ? 'ready' : 'loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const canManage = dashboard.organization.role === 'owner' || dashboard.organization.role === 'admin'
  const currentProvider = MODEL_PROVIDERS.find((option) => option.id === settings?.model.provider) ?? MODEL_PROVIDERS[0]
  const usageRows = useMemo(() => runtimeUsageRows(dashboard), [dashboard])
  const formDisabled = !canManage || saving
  const continuityNotice = runtimeContinuityNotice(dashboard, settings)

  const clearSecretDrafts = useCallback(() => {
    setModelKeys(emptyModelKeys())
    setModelRemovals(emptyModelRemovals())
    setWebSearchKeys(emptyWebSearchKeys())
    setWebSearchRemovals(emptyWebSearchRemovals())
    setWebReaderKeys(emptyWebReaderKeys())
    setWebReaderRemovals(emptyWebReaderRemovals())
    setSandboxKeys(emptySandboxKeys())
    setSandboxRemovals(emptySandboxRemovals())
  }, [])

  const acceptSettings = useCallback((nextSettings: BrainRuntimeSettings) => {
    setSettings(nextSettings)
    setDraft(draftFromSettings(nextSettings))
    if (isAlternativeModelProvider(nextSettings.model.provider)) {
      setAlternativeModelsExpanded(true)
    }
    clearSecretDrafts()
  }, [clearSecretDrafts])

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    if (demoMode) {
      acceptSettings(DEMO_RUNTIME_SETTINGS)
      setLoadState('ready')
      return
    }

    setLoadState('loading')
    try {
      const nextSettings = await fetchBrainRuntimeSettings(signal)
      if (signal?.aborted) return
      acceptSettings(nextSettings)
      setNotice(null)
      setLoadState('ready')
    } catch (error) {
      if (signal?.aborted) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof BrainRuntimeSettingsHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'Brain runtime settings are unavailable.'),
      })
      setLoadState('error')
    }
  }, [acceptSettings, demoMode, onAuthenticationRequired])

  useEffect(() => {
    const controller = new AbortController()
    void loadSettings(controller.signal)
    return () => controller.abort()
  }, [loadSettings])

  const setModelKey = (provider: BrainModelCredentialProvider, value: string) => {
    setModelKeys((current) => ({ ...current, [provider]: value }))
    if (value) setModelRemovals((current) => ({ ...current, [provider]: false }))
    setNotice(null)
  }

  const setWebReaderKey = (provider: BrainWebReaderCredentialProvider, value: string) => {
    setWebReaderKeys((current) => ({ ...current, [provider]: value }))
    if (value) setWebReaderRemovals((current) => ({ ...current, [provider]: false }))
    setNotice(null)
  }

  const setWebSearchKey = (provider: BrainWebSearchCredentialProvider, value: string) => {
    setWebSearchKeys((current) => ({ ...current, [provider]: value }))
    if (value) setWebSearchRemovals((current) => ({ ...current, [provider]: false }))
    setNotice(null)
  }

  const setSandboxKey = (provider: BrainSandboxCredentialProvider, value: string) => {
    setSandboxKeys((current) => ({ ...current, [provider]: value }))
    if (value) setSandboxRemovals((current) => ({ ...current, [provider]: false }))
    setNotice(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canManage || saving || !settings) return

    const modelId = draft.modelIds[draft.modelProvider].trim()
    const webAccess = webAccessRuntimeProviders(draft.webAccessProvider)
    if (!modelId) {
      setNotice({ tone: 'error', message: 'Choose a model identifier before saving.' })
      return
    }
    if (draft.modelProvider !== 'managed' && !credentialWillRemain(
      settings.model.credentials[draft.modelProvider].api_key_configured,
      modelKeys[draft.modelProvider],
      modelRemovals[draft.modelProvider],
    )) {
      setNotice({ tone: 'error', message: `Add the ${providerLabel(MODEL_PROVIDERS, draft.modelProvider)} API key before using it.` })
      return
    }
    if (draft.webAccessProvider === 'tavily' && !credentialWillRemain(
      settings.tools.web_search.credentials.tavily.api_key_configured,
      webSearchKeys.tavily,
      webSearchRemovals.tavily,
    )) {
      setNotice({ tone: 'error', message: 'Add the Tavily API key before using it for web search.' })
      return
    }
    const webPolicyError = webRuntimeSubmissionError(webRuntimePolicyInput(draft, settings))
    if (webPolicyError) {
      setNotice({ tone: 'error', message: webPolicyError })
      return
    }
    if (draft.webAccessProvider === 'firecrawl' || draft.webAccessProvider === 'scrape-do') {
      if (!credentialWillRemain(
        settings.tools.web_reader.credentials[draft.webAccessProvider].api_key_configured,
        webReaderKeys[draft.webAccessProvider],
        webReaderRemovals[draft.webAccessProvider],
      )) {
        setNotice({ tone: 'error', message: `Add the ${providerLabel(WEB_ACCESS_PROVIDERS, draft.webAccessProvider)} API key before using it.` })
        return
      }
    }
    if (
      draft.sandboxProvider === 'daytona'
      || draft.sandboxProvider === 'blaxel'
      || draft.sandboxProvider === 'cloudflare'
    ) {
      if (!credentialWillRemain(
        settings.tools.sandbox.credentials[draft.sandboxProvider].api_key_configured,
        sandboxKeys[draft.sandboxProvider],
        sandboxRemovals[draft.sandboxProvider],
      )) {
        setNotice({ tone: 'error', message: `Add the ${providerLabel(SANDBOX_PROVIDERS, draft.sandboxProvider)} API key before using it.` })
        return
      }
    }
    if (draft.sandboxProvider === 'blaxel' && !draft.blaxelWorkspace.trim()) {
      setNotice({ tone: 'error', message: 'Add the Blaxel workspace before using its sandbox.' })
      return
    }
    if (draft.sandboxProvider === 'cloudflare' && !draft.cloudflareBridgeUrl.trim()) {
      setNotice({ tone: 'error', message: 'Add the Cloudflare sandbox bridge URL before using it.' })
      return
    }
    if (draft.sandboxProvider === 'cloudflare' && !isHttpsUrl(draft.cloudflareBridgeUrl)) {
      setNotice({ tone: 'error', message: 'Enter a valid HTTPS Cloudflare sandbox bridge URL.' })
      return
    }
    if (draft.sandboxProvider === 'managed' && !settings.tools.sandbox.managed_available) {
      setNotice({ tone: 'error', message: 'The managed sandbox is not available on this deployment.' })
      return
    }
    const modelCredentials = credentialUpdates(MODEL_CREDENTIAL_PROVIDERS, modelKeys, modelRemovals)
    const webSearchCredentials = credentialUpdates(
      WEB_SEARCH_CREDENTIAL_PROVIDERS,
      webSearchKeys,
      webSearchRemovals,
    )
    const webReaderCredentials = credentialUpdates(
      WEB_READER_CREDENTIAL_PROVIDERS,
      webReaderKeys,
      webReaderRemovals,
    )
    const sandboxCredentials = credentialUpdates(
      SANDBOX_CREDENTIAL_PROVIDERS,
      sandboxKeys,
      sandboxRemovals,
    )
    setSaving(true)
    setNotice(null)
    try {
      const nextSettings = demoMode
        ? previewSettings(settings, draft, {
            modelKeys,
            modelRemovals,
            webSearchKeys,
            webSearchRemovals,
            webReaderKeys,
            webReaderRemovals,
            sandboxKeys,
            sandboxRemovals,
          })
        : await updateBrainRuntimeSettings({
            model: {
              provider: draft.modelProvider,
              model_id: modelId,
              ...(hasEntries(modelCredentials) ? { credentials: modelCredentials } : {}),
            },
            tools: {
              web_search_enabled: webAccess.webSearchProvider !== 'disabled',
              web_search: {
                provider: webAccess.webSearchProvider,
                ...(hasEntries(webSearchCredentials) ? { credentials: webSearchCredentials } : {}),
              },
              firecrawl: {
                enabled: webAccess.webReaderProvider === 'firecrawl',
              },
              web_reader: {
                provider: webAccess.webReaderProvider,
                ...(hasEntries(webReaderCredentials) ? { credentials: webReaderCredentials } : {}),
              },
              sandbox: {
                provider: draft.sandboxProvider,
                ...(hasEntries(sandboxCredentials) ? { credentials: sandboxCredentials } : {}),
                daytona_target: draft.daytonaTarget.trim() || null,
                blaxel_workspace: draft.blaxelWorkspace.trim() || null,
                cloudflare_bridge_url: draft.cloudflareBridgeUrl.trim() || null,
              },
            },
          })
      acceptSettings(nextSettings)
      setNotice({
        tone: 'success',
        message: demoMode
          ? 'Preview updated for this demo session.'
          : 'Brain settings saved. New turns will use this configuration.',
      })
    } catch (error) {
      if (error instanceof BrainRuntimeSettingsHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'Brain settings could not be saved.'),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loadState === 'loading') {
    return <section className="brain-runtime-settings brain-runtime-settings--state" role="status">Loading brain settings…</section>
  }

  if (loadState === 'error' || !settings) {
    return (
      <section className="brain-runtime-settings brain-runtime-settings--state" aria-labelledby="brain-runtime-settings-error-title">
        <h1 id="brain-runtime-settings-error-title">Brain settings are unavailable.</h1>
        <p>{notice?.message ?? 'Brain settings are temporarily unavailable. Please try again.'}</p>
        <button type="button" onClick={() => void loadSettings()}>Try again</button>
      </section>
    )
  }

  const renderModelProvider = (option: ModelProviderOption) => {
    const selected = draft.modelProvider === option.id
    const credentialProvider = option.id === 'managed' ? null : option.id
    const configured = credentialProvider === null
      || settings.model.credentials[credentialProvider].api_key_configured
    const removalStaged = credentialProvider === null ? false : modelRemovals[credentialProvider]

    return (
      <ProviderChoice
        key={option.id}
        value={option.id}
        label={option.label}
        description={option.description}
        status={providerStatus({
          selected,
          configured,
          replacementStaged: credentialProvider === null ? false : Boolean(modelKeys[credentialProvider].trim()),
          removalStaged,
          disabledProvider: false,
          managed: option.id === 'managed',
        })}
        selected={selected}
        disabled={formDisabled}
        onSelect={() => {
          setDraft((current) => {
            const nativeWebUnavailable = current.webAccessProvider === 'native'
              && !nativeModelWebAvailable(
                option.id,
                settings.tools.managed_web_search_available,
              )
            return {
              ...current,
              modelProvider: option.id,
              ...(nativeWebUnavailable
                ? {
                    webAccessProvider: settings.tools.web_reader.managed_available
                      ? 'managed' as const
                      : 'disabled' as const,
                  }
                : {}),
            }
          })
          setNotice(null)
        }}
      >
        <TextField
          id={`brain-model-${option.id}-id`}
          label="Model identifier"
          value={draft.modelIds[option.id]}
          placeholder={option.defaultModel}
          help={option.id === 'ai-gateway' || option.id === 'openrouter'
            ? 'Use provider/model format.'
            : 'Applied to new turns after save.'}
          disabled={formDisabled || option.id === 'managed'}
          onChange={(value) => setDraft((current) => ({
            ...current,
            modelIds: { ...current.modelIds, [option.id]: value },
          }))}
        />
        {credentialProvider === null ? (
          <p className="brain-runtime-settings__managed-note">Model credentials are included with your Company Brain plan.</p>
        ) : (
          <>
            <SecretField
              id={`brain-model-${credentialProvider}-key`}
              label={`${option.label} API key`}
              value={modelKeys[credentialProvider]}
              placeholder="Paste provider API key"
              configured={settings.model.credentials[credentialProvider].api_key_configured}
              removalStaged={modelRemovals[credentialProvider]}
              disabled={formDisabled}
              onChange={(value) => setModelKey(credentialProvider, value)}
              onToggleRemoval={() => {
                setModelRemovals((current) => ({ ...current, [credentialProvider]: !current[credentialProvider] }))
                setModelKeys((current) => ({ ...current, [credentialProvider]: '' }))
                setNotice(null)
              }}
            />
            <p className="brain-runtime-provider__policy-note">
              Model usage on this key is billed by {option.label} and does not consume your managed model allowance. Any managed resources you use can still count toward plan limits.
            </p>
          </>
        )}
      </ProviderChoice>
    )
  }

  return (
    <form className="brain-runtime-settings brain-runtime-provider-settings" onSubmit={(event) => void submit(event)}>
      <header className="brain-runtime-settings__header">
        <div>
          <h1>How the brain thinks.</h1>
          <p>Choose the model, search, reading tools and runtime behind {dashboard.organization.name}.</p>
        </div>
        <div className="brain-runtime-settings__status" aria-label="Current brain configuration">
          <span>Current runtime</span>
          <strong>{currentProvider.label}</strong>
          <small>{settings.model.model_id}</small>
        </div>
      </header>

      {!canManage ? (
        <div className="brain-runtime-settings__notice" role="status">
          You can review these settings. An organization admin or owner can change them.
        </div>
      ) : null}
      {notice ? (
        <div className={`brain-runtime-settings__notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </div>
      ) : null}
      {continuityNotice ? (
        <section className={`brain-runtime-continuity is-${continuityNotice.tone}`} role="status" aria-label="Plan continuity">
          <span>Plan continuity</span>
          <strong>{continuityNotice.title}</strong>
          <p>{continuityNotice.message}</p>
        </section>
      ) : null}

      <div className="brain-runtime-settings__configuration brain-runtime-provider-settings__configuration">
        <section className="brain-runtime-settings__column" aria-labelledby="brain-model-settings-title">
          <div className="brain-runtime-settings__section-heading">
            <span>01</span>
            <div><h2 id="brain-model-settings-title">Model</h2><p>Pick who runs each Company Brain turn.</p></div>
          </div>

          <Accordion defaultValue={[]} className="brain-runtime-provider-accordion" aria-label="Primary model provider">
            {PRIMARY_MODEL_PROVIDERS.map(renderModelProvider)}
          </Accordion>

          <AlternativeModelDisclosure
            expanded={alternativeModelsExpanded}
            onToggle={() => setAlternativeModelsExpanded((current) => !current)}
          />

          <div
            id="brain-runtime-alternative-models"
            hidden={!alternativeModelsExpanded}
          >
            <Accordion
              defaultValue={[]}
              className="brain-runtime-provider-accordion brain-runtime-provider-accordion--alternatives"
              aria-label="More model providers"
            >
              {ALTERNATIVE_MODEL_PROVIDERS.map(renderModelProvider)}
            </Accordion>
          </div>
        </section>

        <section className="brain-runtime-settings__column" aria-labelledby="brain-web-access-settings-title">
          <div className="brain-runtime-settings__section-heading">
            <span>02</span>
            <div><h2 id="brain-web-access-settings-title">Web access</h2><p>Choose one route for public-web research and page reading.</p></div>
          </div>

          <Accordion defaultValue={[]} className="brain-runtime-provider-accordion" aria-label="Web access provider">
            {WEB_ACCESS_PROVIDERS.map((option) => {
              const selected = draft.webAccessProvider === option.id
              const nativeUnavailable = option.id === 'native'
                && !nativeModelWebAvailable(
                  draft.modelProvider,
                  settings.tools.managed_web_search_available,
                )
              const unavailable = (option.id === 'managed'
                && !settings.tools.web_reader.managed_available)
                || nativeUnavailable
              const readerCredentialProvider = option.id === 'firecrawl' || option.id === 'scrape-do'
                ? option.id
                : null
              const searchCredentialProvider = option.id === 'tavily' ? option.id : null
              const configured = readerCredentialProvider
                ? settings.tools.web_reader.credentials[readerCredentialProvider].api_key_configured
                : searchCredentialProvider
                  ? settings.tools.web_search.credentials[searchCredentialProvider].api_key_configured
                  : true
              const removalStaged = readerCredentialProvider
                ? webReaderRemovals[readerCredentialProvider]
                : searchCredentialProvider
                  ? webSearchRemovals[searchCredentialProvider]
                  : false
              return (
                <ProviderChoice
                  key={option.id}
                  value={option.id}
                  label={option.label}
                  description={option.description}
                  status={unavailable ? 'Unavailable' : option.id === 'native'
                    ? selected ? 'Active · global billing' : 'Available'
                    : providerStatus({
                        selected,
                        configured,
                        replacementStaged: readerCredentialProvider
                          ? Boolean(webReaderKeys[readerCredentialProvider].trim())
                          : searchCredentialProvider
                            ? Boolean(webSearchKeys[searchCredentialProvider].trim())
                            : false,
                        removalStaged,
                        disabledProvider: option.id === 'disabled',
                        managed: option.id === 'managed',
                      })}
                  selected={selected}
                  disabled={formDisabled || unavailable}
                  onSelect={() => {
                    setDraft((current) => ({ ...current, webAccessProvider: option.id }))
                    setNotice(null)
                  }}
                >
                  {readerCredentialProvider ? (
                    <>
                      <SecretField
                        id={`brain-web-reader-${readerCredentialProvider}-key`}
                        label={`${option.label} API key`}
                        value={webReaderKeys[readerCredentialProvider]}
                        placeholder={`Paste ${option.label} API key`}
                        configured={settings.tools.web_reader.credentials[readerCredentialProvider].api_key_configured}
                        removalStaged={webReaderRemovals[readerCredentialProvider]}
                        disabled={formDisabled}
                        onChange={(value) => setWebReaderKey(readerCredentialProvider, value)}
                        onToggleRemoval={() => {
                          setWebReaderRemovals((current) => ({
                            ...current,
                            [readerCredentialProvider]: !current[readerCredentialProvider],
                          }))
                          setWebReaderKeys((current) => ({ ...current, [readerCredentialProvider]: '' }))
                          setNotice(null)
                        }}
                      />
                      <p className="brain-runtime-provider__policy-note">
                        {option.id === 'firecrawl'
                          ? 'Delegated web work uses this Firecrawl account and does not draw from managed credits.'
                          : 'Direct page reads use this Scrape.do account and do not draw from managed credits.'}
                      </p>
                    </>
                  ) : searchCredentialProvider ? (
                    <>
                      <SecretField
                        id="brain-web-search-tavily-key"
                        label="Tavily API key"
                        value={webSearchKeys.tavily}
                        placeholder="Paste Tavily API key"
                        configured={settings.tools.web_search.credentials.tavily.api_key_configured}
                        removalStaged={webSearchRemovals.tavily}
                        disabled={formDisabled}
                        onChange={(value) => setWebSearchKey('tavily', value)}
                        onToggleRemoval={() => {
                          setWebSearchRemovals((current) => ({ ...current, tavily: !current.tavily }))
                          setWebSearchKeys((current) => ({ ...current, tavily: '' }))
                          setNotice(null)
                        }}
                      />
                      <p className="brain-runtime-provider__policy-note">
                        Search calls use this Tavily account and do not draw from managed credits.
                      </p>
                    </>
                  ) : (
                    <p className="brain-runtime-settings__managed-note">
                      {option.id === 'managed'
                        ? unavailable
                          ? 'Managed Firecrawl is not configured on this deployment.'
                          : 'Plan Firecrawl credits are used first. If they cannot cover a task, supported models fall back to native web through global billing.'
                        : option.id === 'native'
                          ? unavailable
                            ? 'The selected model provider does not expose native web search.'
                            : 'No delegated reader or managed Firecrawl credits are used. Native calls are tracked in global billing usage.'
                          : 'All public-web capability is disabled.'}
                    </p>
                  )}
                </ProviderChoice>
              )
            })}
          </Accordion>
        </section>
      </div>

      <div className="brain-runtime-settings__configuration brain-runtime-provider-settings__configuration brain-runtime-provider-settings__configuration--secondary brain-runtime-provider-settings__configuration--single">
        <section className="brain-runtime-settings__column" aria-labelledby="brain-sandbox-settings-title">
          <div className="brain-runtime-settings__section-heading">
            <span>03</span>
            <div><h2 id="brain-sandbox-settings-title">Sandbox</h2><p>Choose where isolated Brain tasks run.</p></div>
          </div>

          <Accordion defaultValue={[]} className="brain-runtime-provider-accordion" aria-label="Sandbox provider">
            {SANDBOX_PROVIDERS.map((option) => {
              const selected = draft.sandboxProvider === option.id
              const unavailable = option.id === 'managed'
                && !settings.tools.sandbox.managed_available
              const credentialProvider = option.id === 'daytona'
                || option.id === 'blaxel'
                || option.id === 'cloudflare'
                ? option.id
                : null
              const configured = credentialProvider
                ? settings.tools.sandbox.credentials[credentialProvider].api_key_configured
                : true
              const removalStaged = credentialProvider ? sandboxRemovals[credentialProvider] : false
              return (
                <ProviderChoice
                  key={option.id}
                  value={option.id}
                  label={option.label}
                  description={option.description}
                  status={unavailable ? 'Unavailable' : providerStatus({
                    selected,
                    configured,
                    replacementStaged: credentialProvider ? Boolean(sandboxKeys[credentialProvider].trim()) : false,
                    removalStaged,
                    disabledProvider: option.id === 'disabled',
                    managed: option.id === 'managed',
                  })}
                  selected={selected}
                  disabled={formDisabled || unavailable}
                  onSelect={() => {
                    setDraft((current) => ({ ...current, sandboxProvider: option.id }))
                    setNotice(null)
                  }}
                >
                  {option.id === 'daytona' ? (
                    <>
                      <TextField
                        id="brain-sandbox-daytona-target"
                        label="Daytona target"
                        value={draft.daytonaTarget}
                        placeholder="default-target"
                        help="Optional target used when a new sandbox is created."
                        disabled={formDisabled}
                        onChange={(value) => setDraft((current) => ({ ...current, daytonaTarget: value }))}
                      />
                      <SecretField
                        id="brain-sandbox-daytona-key"
                        label="Daytona API key"
                        value={sandboxKeys.daytona}
                        placeholder="Paste Daytona API key"
                        configured={settings.tools.sandbox.credentials.daytona.api_key_configured}
                        removalStaged={sandboxRemovals.daytona}
                        disabled={formDisabled}
                        onChange={(value) => setSandboxKey('daytona', value)}
                        onToggleRemoval={() => {
                          setSandboxRemovals((current) => ({ ...current, daytona: !current.daytona }))
                          setSandboxKeys((current) => ({ ...current, daytona: '' }))
                          setNotice(null)
                        }}
                      />
                    </>
                  ) : option.id === 'blaxel' ? (
                    <>
                      <TextField
                        id="brain-sandbox-blaxel-workspace"
                        label="Blaxel workspace"
                        value={draft.blaxelWorkspace}
                        placeholder="workspace-name"
                        help="The workspace used for bounded, approval-gated isolated execution."
                        disabled={formDisabled}
                        onChange={(value) => setDraft((current) => ({ ...current, blaxelWorkspace: value }))}
                      />
                      <SecretField
                        id="brain-sandbox-blaxel-key"
                        label="Blaxel API key"
                        value={sandboxKeys.blaxel}
                        placeholder="Paste Blaxel API key"
                        configured={settings.tools.sandbox.credentials.blaxel.api_key_configured}
                        removalStaged={sandboxRemovals.blaxel}
                        disabled={formDisabled}
                        onChange={(value) => setSandboxKey('blaxel', value)}
                        onToggleRemoval={() => {
                          setSandboxRemovals((current) => ({ ...current, blaxel: !current.blaxel }))
                          setSandboxKeys((current) => ({ ...current, blaxel: '' }))
                          setNotice(null)
                        }}
                      />
                    </>
                  ) : option.id === 'cloudflare' ? (
                    <>
                      <TextField
                        id="brain-sandbox-cloudflare-bridge-url"
                        label="Cloudflare bridge URL"
                        value={draft.cloudflareBridgeUrl}
                        placeholder="https://cloudflare-sandbox-bridge.your-subdomain.workers.dev"
                        help="HTTPS endpoint for your Sandbox Bridge. Configure its outbound network policy in Cloudflare."
                        disabled={formDisabled}
                        onChange={(value) => setDraft((current) => ({ ...current, cloudflareBridgeUrl: value }))}
                      />
                      <SecretField
                        id="brain-sandbox-cloudflare-key"
                        label="Sandbox Bridge API key"
                        value={sandboxKeys.cloudflare}
                        placeholder="Paste Sandbox Bridge API key"
                        configured={settings.tools.sandbox.credentials.cloudflare.api_key_configured}
                        removalStaged={sandboxRemovals.cloudflare}
                        disabled={formDisabled}
                        onChange={(value) => setSandboxKey('cloudflare', value)}
                        onToggleRemoval={() => {
                          setSandboxRemovals((current) => ({ ...current, cloudflare: !current.cloudflare }))
                          setSandboxKeys((current) => ({ ...current, cloudflare: '' }))
                          setNotice(null)
                        }}
                      />
                    </>
                  ) : (
                    <p className="brain-runtime-settings__managed-note">
                      {option.id === 'managed'
                        ? unavailable
                          ? 'No managed sandbox is configured on this deployment.'
                          : 'Sandbox credentials and lifecycle are managed by MemCode.'
                        : 'Isolated execution stays unavailable until another sandbox is selected.'}
                    </p>
                  )}
                  {credentialProvider ? (
                    <p className="brain-runtime-provider__policy-note">
                      Sandbox runtime on this key is billed by {option.label} and does not consume your managed sandbox allowance.
                    </p>
                  ) : null}
                </ProviderChoice>
              )
            })}
          </Accordion>
        </section>

      </div>

      <section className="brain-runtime-settings__usage" aria-labelledby="brain-runtime-usage-title">
        <header><div><span>04</span><h2 id="brain-runtime-usage-title">Usage</h2></div><p>Current plan period</p></header>
        <div>
          {usageRows.map((row) => (
            <article
              key={row.label}
              className={row.exactUsage ? 'brain-runtime-settings__usage-exact' : undefined}
            >
              <span>{row.label}</span>
              <strong>{row.exactUsage ?? (row.percent === null ? 'Metering' : `${row.percent}%`)}</strong>
              <div aria-hidden="true"><i style={{ width: `${row.percent ?? 0}%` }} /></div>
              <small>{row.description}</small>
            </article>
          ))}
        </div>
      </section>

      {canViewBrainUsage(dashboard) ? (
        <BrainByokSpend
          id="brain-runtime-byok-spend"
          resources={dashboard.byok_usage ?? []}
        />
      ) : null}

      <footer className="brain-runtime-settings__footer">
        <span>{demoMode ? 'Preview changes stay in this demo session.' : settings.updated_at ? `Last saved ${formatDate(settings.updated_at)}.` : 'Not changed yet.'}</span>
        <button type="submit" disabled={!canManage || saving}>{saving ? 'Saving…' : demoMode ? 'Update preview' : 'Save brain settings'}</button>
      </footer>
    </form>
  )
}

function credentialUpdates<T extends string>(
  providers: readonly T[],
  keys: Record<T, string>,
  removals: Record<T, boolean>,
) {
  const updates = {} as Partial<Record<T, RuntimeCredentialUpdate>>
  for (const provider of providers) {
    const apiKey = keys[provider].trim()
    if (apiKey) updates[provider] = { api_key: apiKey }
    else if (removals[provider]) updates[provider] = { remove: true }
  }
  return updates
}

function hasEntries(value: object) {
  return Object.keys(value).length > 0
}

function credentialWillRemain(configured: boolean, replacement: string, removalStaged: boolean) {
  return Boolean(replacement.trim()) || (configured && !removalStaged)
}

function providerLabel<T extends string>(options: ReadonlyArray<ProviderOption<T>>, provider: T) {
  return options.find((option) => option.id === provider)?.label ?? provider
}

function webRuntimePolicyInput(
  draft: Pick<RuntimeDraft, 'modelProvider' | 'webAccessProvider'>,
  settings: BrainRuntimeSettings,
): WebRuntimePolicyInput {
  const webAccess = webAccessRuntimeProviders(draft.webAccessProvider)
  return {
    modelProvider: draft.modelProvider,
    ...webAccess,
    managedResearchAvailable: settings.tools.managed_web_search_available,
    managedReaderAvailable: settings.tools.web_reader.managed_available,
  }
}

function isAlternativeModelProvider(provider: BrainModelProvider) {
  return provider === 'ai-gateway' || provider === 'openrouter' || provider === 'vertex-ai'
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

function providerStatus({
  selected,
  configured,
  replacementStaged,
  removalStaged,
  disabledProvider,
  managed,
}: {
  selected: boolean
  configured: boolean
  replacementStaged: boolean
  removalStaged: boolean
  disabledProvider: boolean
  managed: boolean
}) {
  if (disabledProvider) return selected ? 'Off' : 'Available'
  if (removalStaged) return 'Removal staged'
  if (managed) return selected ? 'Active · included' : 'Included'
  if (replacementStaged) return selected ? 'Active · ready to save' : 'Ready to save'
  if (selected) return configured ? 'Active · key saved' : 'Active · needs key'
  return configured ? 'Key saved' : 'Needs key'
}

function previewSettings(
  current: BrainRuntimeSettings,
  draft: RuntimeDraft,
  credentials: CredentialDrafts,
): BrainRuntimeSettings {
  const webAccess = webAccessRuntimeProviders(draft.webAccessProvider)
  const modelCredentials = {
    openai: {
      api_key_configured: previewCredential(
        current.model.credentials.openai.api_key_configured,
        credentials.modelKeys.openai,
        credentials.modelRemovals.openai,
      ),
    },
    anthropic: {
      api_key_configured: previewCredential(
        current.model.credentials.anthropic.api_key_configured,
        credentials.modelKeys.anthropic,
        credentials.modelRemovals.anthropic,
      ),
    },
    google: {
      api_key_configured: previewCredential(
        current.model.credentials.google.api_key_configured,
        credentials.modelKeys.google,
        credentials.modelRemovals.google,
      ),
    },
    'ai-gateway': {
      api_key_configured: previewCredential(
        current.model.credentials['ai-gateway'].api_key_configured,
        credentials.modelKeys['ai-gateway'],
        credentials.modelRemovals['ai-gateway'],
      ),
    },
    openrouter: {
      api_key_configured: previewCredential(
        current.model.credentials.openrouter.api_key_configured,
        credentials.modelKeys.openrouter,
        credentials.modelRemovals.openrouter,
      ),
    },
    'vertex-ai': {
      api_key_configured: previewCredential(
        current.model.credentials['vertex-ai'].api_key_configured,
        credentials.modelKeys['vertex-ai'],
        credentials.modelRemovals['vertex-ai'],
      ),
    },
  }
  const webSearchCredentials = {
    tavily: {
      api_key_configured: previewCredential(
        current.tools.web_search.credentials.tavily.api_key_configured,
        credentials.webSearchKeys.tavily,
        credentials.webSearchRemovals.tavily,
      ),
    },
  }
  const webReaderCredentials = {
    firecrawl: {
      api_key_configured: previewCredential(
        current.tools.web_reader.credentials.firecrawl.api_key_configured,
        credentials.webReaderKeys.firecrawl,
        credentials.webReaderRemovals.firecrawl,
      ),
    },
    'scrape-do': {
      api_key_configured: previewCredential(
        current.tools.web_reader.credentials['scrape-do'].api_key_configured,
        credentials.webReaderKeys['scrape-do'],
        credentials.webReaderRemovals['scrape-do'],
      ),
    },
  }
  const sandboxCredentials = {
    daytona: {
      api_key_configured: previewCredential(
        current.tools.sandbox.credentials.daytona.api_key_configured,
        credentials.sandboxKeys.daytona,
        credentials.sandboxRemovals.daytona,
      ),
    },
    blaxel: {
      api_key_configured: previewCredential(
        current.tools.sandbox.credentials.blaxel.api_key_configured,
        credentials.sandboxKeys.blaxel,
        credentials.sandboxRemovals.blaxel,
      ),
    },
    cloudflare: {
      api_key_configured: previewCredential(
        current.tools.sandbox.credentials.cloudflare.api_key_configured,
        credentials.sandboxKeys.cloudflare,
        credentials.sandboxRemovals.cloudflare,
      ),
    },
  }

  return {
    model: {
      provider: draft.modelProvider,
      model_id: draft.modelIds[draft.modelProvider].trim(),
      api_key_configured: draft.modelProvider !== 'managed'
        && modelCredentials[draft.modelProvider].api_key_configured,
      credentials: modelCredentials,
    },
    tools: {
      web_search_enabled: webAccess.webSearchProvider !== 'disabled',
      managed_web_search_available: current.tools.managed_web_search_available,
      web_search: {
        provider: webAccess.webSearchProvider,
        managed_available: current.tools.web_search.managed_available,
        credentials: webSearchCredentials,
      },
      firecrawl: {
        enabled: webAccess.webReaderProvider === 'firecrawl',
        api_key_configured: webReaderCredentials.firecrawl.api_key_configured,
      },
      web_reader: {
        provider: webAccess.webReaderProvider,
        managed_available: current.tools.web_reader.managed_available,
        credentials: webReaderCredentials,
      },
      sandbox: {
        provider: draft.sandboxProvider,
        managed_available: current.tools.sandbox.managed_available,
        credentials: sandboxCredentials,
        daytona_target: draft.daytonaTarget.trim() || null,
        blaxel_workspace: draft.blaxelWorkspace.trim() || null,
        cloudflare_bridge_url: draft.cloudflareBridgeUrl.trim() || null,
      },
      browser: current.tools.browser,
      x: current.tools.x,
    },
    updated_at: new Date().toISOString(),
  }
}

function previewCredential(current: boolean, replacement: string, removalStaged: boolean) {
  if (replacement.trim()) return true
  if (removalStaged) return false
  return current
}

function runtimeUsageRows(dashboard: BrainDashboard) {
  return [
    {
      label: 'Model turns',
      counter: 'model_turns',
      description: 'Reasoning and answer generation.',
    },
    {
      label: 'Managed web credits',
      counter: 'managed_web_credits',
      description: 'Included Firecrawl credits used by delegated Web Agent tasks.',
    },
    {
      label: 'Research tools',
      counter: 'research_calls',
      description: 'Search, web reading and public context.',
    },
    {
      label: 'Connected tools',
      counter: 'connected_app_calls',
      description: 'Authorized connector requests.',
    },
    {
      label: 'Sandbox runtime',
      counter: 'sandbox_seconds',
      description: 'Managed isolated execution time.',
    },
  ].map((row) => {
    const used = dashboard.usage?.counters[row.counter]
    const limit = dashboard.usage?.limits?.[row.counter]
    return {
      ...row,
      percent: usagePercent(used, limit),
      exactUsage: row.counter === 'managed_web_credits'
        ? managedWebCreditUsageLabel(used, limit)
        : null,
    }
  })
}

function usagePercent(used: number | undefined, limit: number | null | undefined) {
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return null
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
}

function runtimeContinuityNotice(
  dashboard: BrainDashboard,
  settings: BrainRuntimeSettings | null,
): RuntimeContinuityNotice | null {
  const subscription = dashboard.subscription
  if (!subscription || !settings) return null
  const phase = brainSubscriptionContinuityPhase(subscription)
  if (!phase) return null
  if (phase === 'past_due') {
    return {
      tone: 'action',
      title: 'Your plan payment is past due.',
      message: 'A provider key does not automatically bypass a past-due account. Resolve billing before starting new Brain turns.',
    }
  }
  if (phase === 'suspended') {
    return {
      tone: 'action',
      title: 'Brain access is suspended.',
      message: 'Bring-your-own keys do not bypass an account suspension. Contact support or your workspace owner.',
    }
  }

  const provider = MODEL_PROVIDERS.find((option) => option.id === settings.model.provider)
  const providerLabel = provider?.label ?? formatProviderName(settings.model.provider)
  const keyConfigured = settings.model.provider !== 'managed'
    && settings.model.credentials[settings.model.provider].api_key_configured
  const ownToolProviders = selectedOwnToolProviders(settings)
  const ownToolContinuity = ownToolProviders.length
    ? ` Your selected ${ownToolProviders.join(', ')} resources also stay billed to those provider accounts.`
    : ''

  if (phase === 'ended') {
    if (settings.model.provider === 'managed' || !keyConfigured) {
      return {
        tone: 'action',
        title: 'Your plan access has ended.',
        message: 'Select a bring-your-own model provider and save its key to continue core Brain turns. Other provider-funded tools cannot start a turn without model access. Brain does not switch providers automatically.',
      }
    }
    return {
      tone: 'ready',
      title: 'Your managed plan access has ended; your own providers remain selected.',
      message: `${providerLabel} keeps core model use on your account.${ownToolContinuity} Managed variants still require active plan access.`,
    }
  }

  const accessExpiresAt = subscription.access_expires_at ?? subscription.period_end
  const daysRemaining = brainBillingPeriodDaysRemaining(accessExpiresAt)
  if (daysRemaining === null || daysRemaining < 0 || daysRemaining > 14) return null
  const timing = daysRemaining === 0
    ? 'today'
    : daysRemaining === 1
      ? 'in 1 day'
      : `in ${daysRemaining} days`
  const title = `Your current plan access ends ${timing}.`

  if (settings.model.provider === 'managed') {
    return {
      tone: 'action',
      title,
      message: `Before ${formatDate(accessExpiresAt)}, select a bring-your-own model provider and save its key if you want core Brain continuity. Other own-provider resources stay billed separately, but they cannot start a turn without model access.`,
    }
  }

  if (!keyConfigured) {
    return {
      tone: 'action',
      title,
      message: `Save your ${providerLabel} key before ${formatDate(accessExpiresAt)}. This provider is already selected; other own-provider resources cannot start a turn without model access.`,
    }
  }

  return {
    tone: 'ready',
    title,
    message: `Your ${providerLabel} key is ready for core Brain continuity.${ownToolContinuity} Managed resources can still count toward plan limits until access ends and require an active plan afterward.`,
  }
}

function selectedOwnToolProviders(settings: BrainRuntimeSettings) {
  const providers: string[] = []
  if (
    settings.tools.web_search.provider === 'tavily'
    && settings.tools.web_search.credentials.tavily.api_key_configured
  ) providers.push('Tavily search')
  if (
    (settings.tools.web_reader.provider === 'firecrawl' || settings.tools.web_reader.provider === 'scrape-do')
    && settings.tools.web_reader.credentials[settings.tools.web_reader.provider].api_key_configured
  ) providers.push(`${providerLabel(WEB_ACCESS_PROVIDERS, settings.tools.web_reader.provider)} reader`)
  if (
    (settings.tools.sandbox.provider === 'daytona'
      || settings.tools.sandbox.provider === 'blaxel'
      || settings.tools.sandbox.provider === 'cloudflare')
    && settings.tools.sandbox.credentials[settings.tools.sandbox.provider].api_key_configured
  ) providers.push(`${providerLabel(SANDBOX_PROVIDERS, settings.tools.sandbox.provider)} sandbox`)
  return providers
}

function formatProviderName(value: string) {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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
