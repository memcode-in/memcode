import type { User } from '../contexts/AuthContext'
import type { BrainDashboard } from './brain-dashboard'

// Public demo credentials. This is intentionally a read-only browser demo and
// must never be treated as backend authentication or authorization.
const DEMO_EMAIL = 'test@gmail.com'
const DEMO_PASSWORD = 'test@123'

export const DEMO_SESSION_STORAGE_KEY = 'memcode_demo_session_v1'

export const DEMO_USER: User = {
  id: 'demo-user',
  email: DEMO_EMAIL,
  name: 'Demo Admin',
  username: 'demo-admin',
}

export const DEMO_BRAIN_DASHBOARD: BrainDashboard = {
  viewer: {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  },
  organization: {
    id: 'demo-company',
    name: 'Acme Company',
    domain: 'acme.example',
    role: 'admin',
  },
  permissions: {
    manage_members: false,
    manage_billing: false,
    view_financials: false,
    manage_spaces: false,
  },
  features: {
    code_mode_access: true,
    mcp_access: true,
  },
  subscription: {
    plan_id: 'company-brain-plus',
    plan_name: 'Company Brain Plus',
    status: 'active',
    billing_cycle: 'monthly',
    renewal_mode: 'recurring',
    cancel_at_period_end: false,
    access_expires_at: null,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
  },
  usage: {
    counters: {
      model_turns: 79,
      memories_written: 98,
      retrievals: 1240,
      connected_app_calls: 316,
      research_calls: 48,
      managed_web_credits: 48,
    },
    limits: {
      model_turns: 5000,
      memories_written: 5000,
      retrievals: 25000,
      connected_app_calls: 10000,
      research_calls: 1000,
      managed_web_credits: 250,
    },
    period_start: '2026-08-01',
    period_end: '2026-08-31',
  },
  byok_usage: [
    {
      resource_type: 'model',
      provider: 'openai',
      model_id: 'gpt-5-mini',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      input_tokens: 184250,
      output_tokens: 28140,
      cache_read_tokens: 92100,
      cache_write_tokens: 0,
      cost_usd_micros: 1_842_310,
      cost_source: 'provider_reported',
    },
    {
      resource_type: 'model',
      provider: 'anthropic',
      model_id: 'claude-sonnet-5',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      input_tokens: 62100,
      output_tokens: 8900,
      cache_read_tokens: 18000,
      cache_write_tokens: 2300,
      cost_usd_micros: 672_840,
      cost_source: 'estimated',
      pricing_source: 'Recorded model pricing',
    },
    {
      resource_type: 'model',
      provider: 'google',
      model_id: 'gemini-3.6-flash',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      input_tokens: 19750,
      output_tokens: 3340,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'web_search',
      provider: 'tavily',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      calls: 86,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'web_reader',
      provider: 'firecrawl',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      calls: 34,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'sandbox',
      provider: 'daytona',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      sandbox_seconds: 842,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'browser',
      provider: 'browser-use',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      calls: 7,
      cost_usd_micros: 384_120,
      cost_source: 'provider_reported',
    },
    {
      resource_type: 'x_search',
      provider: 'x',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      calls: 19,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
  ],
  financials: null,
  memory: {
    connection_status: 'connected',
    organization: {
      space_count: 2,
      memory_count: 60,
    },
    personal_dm: {
      space_id: 'demo-personal',
      memory_count: 6,
      updated_at: '2026-08-01T08:30:00.000Z',
    },
    private_channels: {
      space_count: 2,
      memory_count: 32,
    },
    usage: {
      period: '2026-08',
      ingests: 98,
      searches: 1240,
      retrievals: 392,
      stored_memories: 98,
      storage_bytes: 384000,
    },
    spaces: [
      {
        id: 'demo-canonical',
        name: 'Canonical company knowledge',
        kind: 'org_shared',
        visibility: 'organization',
        memory_count: 12,
        updated_at: '2026-08-01T08:40:00.000Z',
      },
      {
        id: 'demo-slack',
        name: 'Slack — Company',
        kind: 'public_channel',
        visibility: 'organization',
        memory_count: 48,
        updated_at: '2026-08-01T08:30:00.000Z',
      },
      {
        id: 'demo-notion',
        name: 'Notion — Knowledge base',
        kind: 'private_channel',
        visibility: 'members',
        memory_count: 20,
        updated_at: '2026-08-01T07:45:00.000Z',
      },
      {
        id: 'demo-linear',
        name: 'Linear — Product',
        kind: 'private_channel',
        visibility: 'members',
        memory_count: 12,
        updated_at: '2026-08-01T06:10:00.000Z',
      },
      {
        id: 'demo-personal',
        name: 'My MemCode DM',
        kind: 'personal',
        visibility: 'owner',
        memory_count: 6,
        updated_at: '2026-08-01T08:30:00.000Z',
      },
    ],
  },
}

export function isValidDemoCredentials(email: string, password: string) {
  return email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD
}
