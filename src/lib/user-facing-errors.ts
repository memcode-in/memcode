export type UserFacingErrorMessages = Readonly<Record<string, string>>

export interface UserFacingApiErrorOptions {
  fallback: string
  messages?: UserFacingErrorMessages
  statusMessages?: Readonly<Partial<Record<number, string>>>
}

export interface UserFacingApiErrorDetails {
  message: string
  code?: string
  retryAfterMs?: number
}

const NETWORK_ERROR_MESSAGE = "We couldn't reach the service. Check your connection and try again."

export const COMMON_ERROR_MESSAGES: UserFacingErrorMessages = {
  authentication_failed: 'Sign-in could not be completed. Please try again.',
  authentication_required: 'Your session expired. Please sign in again.',
  operations_authentication_required: 'Your session expired. Please sign in again.',
  organization_context_changed: 'The active organization changed. Refresh the page before trying again.',
  organization_admin_required: 'Only an organization admin or owner can make this change.',
  invalid_json: 'The request could not be processed. Refresh the page and try again.',
  invalid_query: 'Check the information you entered and try again.',
  invalid_limit: 'The requested view could not be loaded. Refresh the page and try again.',
  payload_too_large: 'That file or request is too large. Choose a smaller one and try again.',
  request_body_too_large: 'That file or request is too large. Choose a smaller one and try again.',
  internal_server_error: 'The service hit a temporary problem. Please try again.',
  method_not_allowed: 'That action is not available here.',
  not_found: 'The requested item is no longer available.',
  untrusted_request_origin: 'This request could not be verified. Refresh the page and try again.',
  client_rate_limit_exceeded: 'Too many requests were made. Wait a moment and try again.',
  client_rate_limit_unavailable: 'Usage limits could not be checked right now. Please try again shortly.',
}

export const AUTH_ERROR_MESSAGES: UserFacingErrorMessages = {
  google_credential_required: 'Google did not return a sign-in credential. Please try again.',
  invalid_client_token: 'This authorization session is no longer valid. Start it again from MemCode.',
  invalid_client_permissions: 'This app requested permissions that are not available.',
  invalid_or_expired_state: 'This authorization request expired. Start it again from MemCode.',
  invalid_oauth_callback: 'The authorization callback could not be verified. Start the connection again.',
  connection_authorization_failed: 'The connection could not be authorized. Please try again.',
  invalid_referral_code: "That referral code isn't valid. Check the code and try again.",
  referral_code_required: 'Enter a referral code to continue.',
}

export const BILLING_ERROR_MESSAGES: UserFacingErrorMessages = {
  package_id_required: 'Choose a plan before continuing.',
  unknown_billing_package: 'That plan is no longer available. Refresh the pricing page and choose again.',
  payment_provider_unavailable: 'Checkout is temporarily unavailable. Please try again shortly.',
  payment_proof_required: 'Payment confirmation was incomplete. Please contact support if you were charged.',
  invalid_payment: 'Payment confirmation could not be verified. Please contact support if you were charged.',
  invalid_signature: 'Payment confirmation could not be verified. Please contact support if you were charged.',
  unknown_checkout: 'That checkout session could not be found. Start checkout again.',
  checkout_mismatch: 'The payment details did not match this checkout. Please contact support if you were charged.',
  provider_mismatch: 'The payment provider did not match this checkout. Start checkout again.',
  subscription_exists: 'This organization already has Company Brain access.',
  subscription_change_required: 'Change the current plan before starting another checkout.',
  subscription_not_found: 'No active subscription was found for this organization.',
  subscription_not_manageable: 'This subscription cannot be changed from the dashboard. Please contact support.',
  plan_unchanged: 'This organization is already on that plan.',
  cancellation_mode_required: 'Choose whether access should end now or at the end of the billing cycle.',
  plan_change_mode_required: 'Choose when the new plan should take effect.',
  pending_lifecycle_change: 'Finish the pending billing change before starting another one.',
  operation_in_progress: 'This change is already being processed. Wait a moment and refresh.',
  operation_failed: 'The billing change could not be completed. Please try again.',
  idempotency_conflict: 'This request was already used for a different change. Refresh and try again.',
  idempotency_key_required: 'The request could not be verified. Refresh and try again.',
  idempotency_key_reused: 'This request has already been processed. Refresh to see the latest status.',
  invoice_not_found: 'That invoice could not be found. Refresh the billing page and try again.',
  invoice_id_required: 'Choose an invoice before requesting a refund.',
  invoice_not_refundable: 'That invoice is not eligible for another refund.',
  invalid_refund: 'The refund could not be processed. Check the amount and try again.',
  invalid_invoice_id: 'Choose a valid invoice and try again.',
  invalid_refund_amount: 'Enter a valid refund amount and try again.',
  onboarding_credit_not_pending: 'There is no pending onboarding credit for this organization.',
  onboarding_credit_already_fulfilled: 'The onboarding credit has already been fulfilled.',
  onboarding_credit_not_applicable: 'This plan is not eligible for an onboarding credit.',
  invalid_fulfillment_reference: 'Enter a valid fulfillment reference and try again.',
  referral_code_required: 'Enter an onboarding code to continue.',
  invalid_referral_code: "That onboarding code isn't valid. Check the code and try again.",
  referral_limit_reached: 'That onboarding code has reached its activation limit.',
  referral_already_used: 'This organization has already used an onboarding code.',
  referral_unavailable: 'Onboarding codes are temporarily unavailable. Please try again later.',
}

export const INTEGRATION_ERROR_MESSAGES: UserFacingErrorMessages = {
  company_brain_plus_required: 'Company Brain Plus is required for MCP setup.',
  mcp_plan_required: 'Company Brain Plus is required for MCP setup.',
  integration_not_found: 'That integration is no longer available. Refresh the connector list.',
  integration_not_configured: 'That integration is not available here yet.',
  integration_coming_soon: 'That integration is not available yet.',
  invalid_integration_configuration: 'That integration is unavailable because its setup is incomplete. Contact an administrator.',
  invalid_integration_execution_policy: 'Choose a valid read or write permission and try again.',
  integration_authorization_failed: 'The integration could not be authorized. Please try again.',
  integration_connection_failed: 'The integration could not be connected. Check the credential and try again.',
  connection_not_found: 'That connection could not be found. Refresh the connector and try again.',
  connection_id_required: 'Choose a connection before continuing.',
  connection_reconnect_required: 'This connection needs to be reconnected before it can be used.',
  connection_unavailable: 'This connection is temporarily unavailable. Please try again.',
  invalid_connection_scope: 'Choose a valid connection scope and try again.',
  personal_connection_required: 'Connect a personal account before using this feature.',
  static_connection_not_available: 'This managed connection is not available here yet.',
  invalid_static_secret: 'Enter a valid connector API key and try again.',
  static_connection_already_exists: 'Disconnect the existing connection before adding another key.',
  static_reconnect_not_supported: 'Disconnect this connection, then connect it again with the new key.',
  agentmail_managed_connection: 'Manage Company Email from Brain settings.',
  custom_connection_in_progress: 'This connection is already being configured. Wait a moment and refresh.',
  custom_connection_rate_limited: 'Too many connection attempts were made. Wait a moment and try again.',
  custom_connection_rejected: 'That server could not be approved. Check its address and access settings.',
  custom_connection_billing_unavailable: 'Your plan could not be verified for this connection. Please try again.',
  custom_connection_operation_unavailable: 'Custom connections are temporarily unavailable. Please try again.',
  custom_connection_replay_unavailable: 'This connection request expired. Start the connection again.',
  custom_connection_save_failed: 'The connection could not be saved. Please try again.',
  invalid_custom_connection: 'Check the server address and connection settings, then try again.',
  provider_mismatch: 'Reconnect with the same provider that created this connection.',
  slack_authorization_rejected: 'Slack authorization was cancelled or rejected. Please try again.',
  slack_installation_failed: 'Slack could not be connected. Please try the installation again.',
  slack_workspace_not_found: 'That Slack workspace could not be found. Reconnect Slack and try again.',
  workspace_not_installed: 'Install the app in this workspace before continuing.',
}

export const ORGANIZATION_ERROR_MESSAGES: UserFacingErrorMessages = {
  invalid_org_id: 'Choose a valid organization and try again.',
  invalid_organization_id: 'Choose a valid organization and try again.',
  invalid_organization_name: 'Enter an organization name between 2 and 80 characters.',
  invalid_organization_role: 'Choose a valid member role and try again.',
  invalid_company_domain: 'Enter a valid public company domain, such as example.com.',
  role_not_assignable: 'That role cannot be assigned by your account.',
  invalid_invitation_email: 'Enter a valid email address for the invitation.',
  invalid_invitation_token: 'That invitation is invalid or has expired.',
  invitation_invalid_or_expired: 'That invitation is invalid or has expired.',
  invitation_email_mismatch: 'Sign in with the email address that received this invitation.',
  invitation_not_found: 'That invitation could not be found.',
  invitation_not_pending: 'That invitation has already been accepted or revoked.',
  member_not_found: 'That member is no longer part of this organization.',
  member_already_exists: 'That person is already a member of this organization.',
  member_role_not_manageable: 'You do not have permission to change that member\'s role.',
  last_owner_required: 'Assign another owner before removing or changing the last owner.',
  organization_not_found: 'That organization could not be found.',
  organization_limit_reached: 'Your account has reached its organization limit.',
  organization_idempotency_conflict: 'This organization request conflicts with an earlier change. Refresh and try again.',
  approval_not_found: 'That approval request is no longer available.',
  invalid_approval_action: 'Choose a valid approval action and try again.',
}

export const RUNTIME_ERROR_MESSAGES: UserFacingErrorMessages = {
  invalid_runtime_settings: 'Check the model and tool settings, then try again.',
  model_api_key_required: 'Add an API key for the selected model provider.',
  web_search_api_key_required: 'Add a Tavily API key before enabling Tavily search.',
  web_reader_api_key_required: 'Add an API key for the selected web reader.',
  managed_web_reader_unavailable: 'The managed web reader is not available in this deployment.',
  sandbox_api_key_required: 'Add an API key for the selected sandbox provider.',
  managed_sandbox_unavailable: 'The managed sandbox is not available in this deployment.',
  browser_api_key_required: 'Add a Browser Use API key before enabling browser tools.',
  blaxel_workspace_required: 'Add your Blaxel workspace before enabling its sandbox.',
  cloudflare_bridge_url_required: 'Add the Cloudflare bridge URL before enabling its sandbox.',
  x_bearer_required: 'Add an X API bearer token before enabling X search.',
  firecrawl_api_key_required: 'Add a Firecrawl API key before enabling the web reader.',
  web_search_unavailable: 'Managed web research is unavailable in the current setup.',
  web_search_not_supported: 'Managed web research is unavailable in the current setup.',
}

export const ONBOARDING_ERROR_MESSAGES: UserFacingErrorMessages = {
  research_attempt_limit_reached: 'This organization has used all available company-research attempts. Contact support before trying again.',
  research_in_progress: 'Company research is already running. Refresh to see its latest progress.',
  onboarding_already_researched: 'Company research is already complete for this organization.',
  company_research_not_configured: 'Company research is not available here yet.',
  company_research_unavailable: 'Company research is temporarily unavailable. Please try again later.',
  onboarding_not_ready: 'The company brief is not ready yet. Refresh and try again.',
  research_run_id_required: 'The research run could not be identified. Refresh and try again.',
  memory_not_ready: 'Company memory is still being prepared. Wait a moment and refresh.',
  invalid_company_domain: 'Enter a valid public company domain, such as example.com.',
  company_website_not_found: 'We could not find a website at that domain. Check the address or enter another company website.',
  company_website_unreachable: 'We could not reach that company website. Check the address or enter another website.',
  company_website_check_unavailable: 'We could not verify that company website right now. Try again in a moment.',
  invalid_company_research_edit: 'Keep the summary under 4,000 characters and use up to 12 highlights.',
  company_research_card_not_found: 'That finding is no longer available. Refresh the brief and try again.',
  research_card_not_editable: 'That finding cannot be edited.',
  stale_research_step: 'The brief changed while you were editing. Review the latest version and try again.',
  idempotency_key_required: 'This Slack history request could not be verified. Refresh and try again.',
  idempotency_key_reused: 'This request key was already used for another Slack history selection. Try again.',
  explicit_channel_selection_required: 'Select at least one public Slack channel.',
  invalid_slack_channel_selection: 'One or more selected Slack channels are no longer available. Refresh the channel list.',
  invalid_slack_history_window: 'Choose a Slack history window from 1 to 365 days.',
  slack_not_connected: 'Reconnect Slack before syncing channel history.',
  slack_memory_provisioning: 'Slack memory is still being prepared. Wait a moment and try again.',
  slack_scopes_required: 'Reconnect Slack to grant the permissions needed for public-channel history.',
  slack_rate_limited: 'Slack is limiting history requests right now. We will continue after its retry window.',
  slack_history_estimate_stale: 'The selected Slack channels changed after this estimate. Recalculate it before starting.',
  history_run_not_found: 'This Slack history estimate is no longer available. Recalculate it.',
  history_estimate_not_ready: 'The Slack message count is not ready yet. Wait a moment and try again.',
  history_in_progress: 'A Slack history sync is already running for this workspace.',
  slack_history_unavailable: 'Slack history is temporarily unavailable. Please try again.',
}

const MACHINE_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u
const TECHNICAL_MESSAGE = /(?:\b(?:exception|traceback|stack trace|sqlstate|econnrefused|enotfound|fetch failed|failed to fetch|load failed)\b|\bVITE_[A-Z0-9_]+\b|(?:^|\s)at\s+[\w$.<>]+\s*\(|\/(?:Users|home|var|opt)\/|^[<{\[])/iu
const RESPONSE_SHAPE_MESSAGE = /(?:\b(?:invalid|unexpected|malformed)\b.*\bresponse\b|\bresponse\b.*\b(?:invalid|unexpected|malformed)\b)/iu

function normalizeText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function errorCode(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return /^[a-z][a-z0-9_]{1,119}$/u.test(normalized) ? normalized : undefined
}

function messageForCode(
  code: string | undefined,
  messages?: UserFacingErrorMessages,
) {
  if (!code) return undefined
  return messages?.[code] ?? COMMON_ERROR_MESSAGES[code]
}

function codeFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  return errorCode(record.code)
    ?? errorCode(record.error)
    ?? (typeof record.detail === 'string' && MACHINE_CODE.test(record.detail.trim())
      ? errorCode(record.detail)
      : undefined)
}

function retryAfterMsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  const value = record.retry_after_ms ?? record.retryAfterMs
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

export async function readUserFacingApiError(
  response: Response,
  options: UserFacingApiErrorOptions,
): Promise<UserFacingApiErrorDetails> {
  let code: string | undefined
  let retryAfterMs: number | undefined
  try {
    const payload = await response.json()
    code = codeFromPayload(payload)
    retryAfterMs = retryAfterMsFromPayload(payload)
  } catch {
    // A context-specific fallback is safer than rendering an unstructured response.
  }

  return {
    message: (code ? options.messages?.[code] : undefined)
      ?? options.statusMessages?.[response.status]
      ?? messageForCode(code)
      ?? options.fallback,
    ...(code ? { code } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}

export function userFacingCodeMessage(
  value: unknown,
  fallback: string,
  messages?: UserFacingErrorMessages,
) {
  return messageForCode(errorCode(value), messages) ?? fallback
}

export function userFacingErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const normalized = normalizeText(error.message)
  if (!normalized) return fallback

  const mappedCode = messageForCode(errorCode(normalized))
  if (mappedCode) return mappedCode
  if (MACHINE_CODE.test(normalized) || TECHNICAL_MESSAGE.test(normalized) || RESPONSE_SHAPE_MESSAGE.test(normalized)) {
    if (/failed to fetch|fetch failed|load failed|econnrefused|enotfound/iu.test(normalized)) {
      return NETWORK_ERROR_MESSAGE
    }
    return fallback
  }

  return normalized.length <= 300 ? normalized : fallback
}
