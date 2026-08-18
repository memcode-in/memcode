import { useState } from 'react'
import { createPortal } from 'react-dom'
import { HouseIcon } from '@phosphor-icons/react'
import ReferralVanish from './ReferralVanish'
import { ReceiptPrinter, type ReceiptPrinterStage } from './ReceiptPrinter'
import { TactileButton } from './TactileButton'
import BookingLink from './marketing/BookingLink'

export interface MemoryInvoice {
  id: string
  date: string
  amount_minor_units?: number
  amount_paise?: number
  currency?: string
  status: 'paid' | 'pending' | 'failed'
  credits: number
  receipt_url?: string
  package_id?: string
  razorpay_payment_id?: string
}

export interface MemoryBillingSummary {
  plan_id?: string
  plan_name: string
  account_status?: string
  status?: string
  currency?: string
  credit_balance?: number
  available_credits?: number
  prepaid_balance_paise?: number
  next_invoice_paise?: number
  current_period_start?: string | null
  current_period_end?: string | null
  invoices?: MemoryInvoice[]
}

export interface MemoryBillingPlan {
  id: string
  name: string
  price_minor_units?: number
  price_paise?: number
  currency: string
  credits: number
  purchase_type?: 'free_trial' | 'one_time'
  validity_days?: number
}

export interface MemoryReceiptState {
  stage: ReceiptPrinterStage
  packageLabel: string
  invoice: MemoryInvoice | null
  source?: 'razorpay' | 'referral'
}

interface MemoryBillingPanelProps {
  summary: MemoryBillingSummary | null
  plans: MemoryBillingPlan[]
  warning: string | null
  notice: { tone: 'success' | 'error'; message: string } | null
  processingPackageId: string | null
  redeemingReferral: boolean
  receipt: MemoryReceiptState | null
  demoMode: boolean
  onCheckout: (plan: MemoryBillingPlan, label: string) => void
  onRedeemReferral: (code: string) => Promise<void>
  onDismissReceipt: () => void
}

const PLAN_ORDER = ['free', 'starter', 'pro'] as const

const FALLBACK_PLANS: MemoryBillingPlan[] = [
  { id: 'free', name: 'Free', price_minor_units: 0, currency: 'USD', credits: 1_000, purchase_type: 'free_trial', validity_days: 30 },
  { id: 'starter', name: 'Starter', price_minor_units: 200, currency: 'USD', credits: 1_500, purchase_type: 'one_time', validity_days: 30 },
  { id: 'pro', name: 'Pro', price_minor_units: 500, currency: 'USD', credits: 3_750, purchase_type: 'one_time', validity_days: 30 },
]

const PLAN_PRESENTATION = {
  free: {
    price: 'Free',
    name: 'Free tier',
    description: 'For getting started with Memory.',
    benefits: ['1,000 credits', '2M input + 500K output', 'Unlimited reads'],
  },
  starter: {
    price: '$2',
    name: 'Starter',
    description: 'For active personal agents and everyday development.',
    benefits: [
      '1,500 credits',
      '3M input + 750K output',
      'Everything in Free tier + 24/7 live support',
      '$200 Company Brain plan free for one month',
    ],
  },
  pro: {
    price: '$5',
    name: 'Pro',
    description: 'For larger memory workloads and production agents.',
    benefits: [
      '3,750 credits',
      '7.5M input + 1.9M output',
      'Everything included in Starter',
      'Company Brain Pro free',
    ],
  },
} as const

const REFERRAL_GRANT_MINOR_UNITS = 500

function minorAmount(invoice: MemoryInvoice) {
  return Number(invoice.amount_minor_units ?? invoice.amount_paise ?? 0)
}

function planAmount(plan: MemoryBillingPlan) {
  return Number(plan.price_minor_units ?? plan.price_paise ?? 0)
}

function currentPlanId(summary: MemoryBillingSummary | null) {
  const id = summary?.plan_id?.trim().toLowerCase()
  if (id === 'free' || id === 'starter' || id === 'pro') return id

  const name = summary?.plan_name?.trim().toLowerCase() || ''
  if (name.includes('pro')) return 'pro'
  if (name.includes('starter')) return 'starter'
  if (name.includes('free')) return 'free'
  return null
}

function formatCurrency(amount: number, currency = 'INR') {
  const normalized = currency.toUpperCase()
  return new Intl.NumberFormat(normalized === 'USD' ? 'en-US' : 'en-IN', {
    style: 'currency',
    currency: normalized,
    maximumFractionDigits: normalized === 'USD' ? 2 : 0,
  }).format(amount / 100)
}

function formatDate(value?: string) {
  if (!value) return 'Pending'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Pending'
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatReceiptDate(value?: string) {
  if (!value) return 'PENDING'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'PENDING'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(',', ' ·').toUpperCase()
}

function formatOrderReference(value?: string) {
  const compact = value?.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  return compact ? `ORD-${compact}` : 'ORD-PENDING'
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function Logo() {
  return <img alt="" className="memory-receipt-machine-logo" src="/logo.jpeg" />
}

function BillingReceiptPrinter({
  receipt,
  onClose,
}: {
  receipt: MemoryReceiptState
  onClose: () => void
}) {
  const invoice = receipt.invoice
  const amount = invoice ? formatCurrency(minorAmount(invoice), invoice.currency) : 'Verifying'
  const isReferral = receipt.source === 'referral'
  const packageTitle = `${receipt.packageLabel} plan`
  const packageSubtitle = isReferral ? 'Referral credit grant' : 'Memory credit purchase'
  const orderReference = formatOrderReference(invoice?.id)
  const taxAmount = invoice ? formatCurrency(0, invoice.currency) : 'Pending'
  const referralGrantAmount = formatCurrency(REFERRAL_GRANT_MINOR_UNITS, 'USD')
  const subtotalAmount = isReferral ? referralGrantAmount : amount
  const adjustmentLabel = isReferral ? 'Referral grant' : 'Tax'
  const adjustmentAmount = isReferral ? `−${referralGrantAmount}` : taxAmount

  return createPortal(
    <div className="memory-receipt-overlay" role="dialog" aria-modal="true" aria-label={isReferral ? 'Referral credit receipt' : 'Payment receipt'}>
      <div className="memory-receipt-overlay__backdrop" aria-hidden="true" />
      <div className="memory-receipt-stage">
        <ReceiptPrinter.Root className="memory-receipt-printer" stage={receipt.stage}>
          <ReceiptPrinter.Machine>
            <ReceiptPrinter.Header className="memory-receipt-header">
              <Logo />
              <TactileButton
                depth="shallow"
                href="/dashboard?section=billing"
                size="sm"
                aria-disabled={receipt.stage !== 'complete'}
                onClick={(event) => {
                  event.preventDefault()
                  if (receipt.stage === 'complete') onClose()
                }}
              >
                <HouseIcon aria-hidden="true" size={13} weight="fill" />
                Home
              </TactileButton>
            </ReceiptPrinter.Header>

            <ReceiptPrinter.Screen className="memory-receipt-display">
              <div className="memory-receipt-display__content">
                <div className="memory-receipt-display__summary">
                  <div>
                    <p>{packageTitle}</p>
                    <p>{packageSubtitle}</p>
                  </div>
                  <div className="memory-receipt-display__total">
                    <span>Total</span>
                    <strong>{amount}</strong>
                  </div>
                </div>
                <ReceiptPrinter.Status className="memory-receipt-status" />
              </div>
            </ReceiptPrinter.Screen>
          </ReceiptPrinter.Machine>

          <ReceiptPrinter.Output className="memory-receipt-output">
            <ReceiptPrinter.Paper className="memory-receipt-paper">
              <div className="memory-receipt-paper__logo">
                <img src="/logo.jpeg" alt="MemCode" />
              </div>

              <div className="memory-receipt-paper__rule" />

              <section className="memory-receipt-paper__plan">
                <div>
                  <strong>{packageTitle}</strong>
                  <span>{packageSubtitle}</span>
                </div>
                <strong>{subtotalAmount}</strong>
              </section>

              <div className="memory-receipt-paper__rule" />

              <dl className="memory-receipt-paper__totals">
                <div><dt>Subtotal</dt><dd>{subtotalAmount}</dd></div>
                <div><dt>{adjustmentLabel}</dt><dd>{adjustmentAmount}</dd></div>
              </dl>

              <dl className="memory-receipt-paper__grand-total">
                <dt>Total paid</dt>
                <dd>{amount}</dd>
              </dl>

              <div className="memory-receipt-paper__rule" />

              <dl className="memory-receipt-paper__meta">
                <div><dt>Order</dt><dd>{orderReference}</dd></div>
                <div><dt>Paid with</dt><dd>{isReferral ? 'Referral code' : 'Razorpay'}</dd></div>
                <div><dt>Date</dt><dd>{formatReceiptDate(invoice?.date)}</dd></div>
              </dl>

              <div className="memory-receipt-paper__barcode" aria-hidden="true" />
              <p className="memory-receipt-paper__barcode-label">{orderReference.replace('-', ' ')}</p>
            </ReceiptPrinter.Paper>
          </ReceiptPrinter.Output>
        </ReceiptPrinter.Root>
      </div>
    </div>,
    document.body,
  )
}

export default function MemoryBillingPanel({
  summary,
  plans,
  warning,
  notice,
  processingPackageId,
  redeemingReferral,
  receipt,
  demoMode,
  onCheckout,
  onRedeemReferral,
  onDismissReceipt,
}: MemoryBillingPanelProps) {
  const [selectedInvoice, setSelectedInvoice] = useState<MemoryInvoice | null>(null)
  const plansById = new Map((plans.length ? plans : FALLBACK_PLANS).map((plan) => [plan.id, plan]))
  const visiblePlans = PLAN_ORDER.map((id) => plansById.get(id) || FALLBACK_PLANS.find((plan) => plan.id === id)!)
  const activePlanId = currentPlanId(summary) || (demoMode ? 'free' : null)
  const invoices = summary?.invoices || []
  const visibleReceipt = receipt || (selectedInvoice ? {
    stage: 'complete' as const,
    packageLabel: selectedInvoice.package_id === 'memory_referral'
      ? 'Pro'
      : PLAN_PRESENTATION[selectedInvoice.package_id as keyof typeof PLAN_PRESENTATION]?.name || 'Memory',
    invoice: selectedInvoice,
    source: selectedInvoice.package_id === 'memory_referral' ? 'referral' as const : 'razorpay' as const,
  } : null)

  return (
    <section className="memory-billing" aria-labelledby="memory-billing-title">
      <header className="memory-surface-header">
        <div>
          <span>Memory billing</span>
          <h1 id="memory-billing-title">Simple credit plans</h1>
          <p>Add credits to your account.</p>
        </div>
        <div className="memory-billing__balance"><small>Available credits</small><strong>{formatCredits(summary?.available_credits ?? summary?.credit_balance ?? 0)}</strong></div>
      </header>

      {warning ? <div className="dashboard-alert" role="status">{warning}</div> : null}
      {notice ? <div className={`dashboard-checkout-notice dashboard-checkout-notice--${notice.tone}`} role="status">{notice.message}</div> : null}

      <ReferralVanish
        id="memory-referral-code"
        label="Have a referral code?"
        description="Apply it to your account."
        disabled={processingPackageId !== null || redeemingReferral}
        isSubmitting={redeemingReferral}
        onApply={onRedeemReferral}
      />

      <div className="memory-billing__plans">
        {visiblePlans.map((plan) => {
          const presentation = PLAN_PRESENTATION[plan.id as keyof typeof PLAN_PRESENTATION]
          const isCurrent = activePlanId === plan.id
          const isFree = plan.id === 'free'
          const processing = processingPackageId === plan.id
          const disabled = isFree || isCurrent || demoMode || processingPackageId !== null
          return (
            <article
              key={plan.id}
              className={`${plan.id === 'starter' ? 'is-featured' : ''}${isCurrent ? ' is-current' : ''}`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <div>
                <span>{presentation.name}</span>
                {isCurrent ? <small>Current plan</small> : plan.id === 'starter' ? <small>Most popular</small> : null}
              </div>
              <strong>{presentation.price}</strong>
              <p>{presentation.description}</p>
              <ul>
                {presentation.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
              </ul>
              <small>{isFree ? 'Included with every account' : `${formatCurrency(planAmount(plan), plan.currency)} total`}</small>
              <button type="button" disabled={disabled} onClick={() => onCheckout(plan, presentation.name)}>
                {isCurrent
                  ? 'Current plan'
                  : isFree
                    ? 'Included'
                    : demoMode
                      ? 'Checkout unavailable in demo'
                      : processing
                        ? 'Opening Razorpay…'
                        : `Choose ${presentation.price}`}
              </button>
            </article>
          )
        })}
        <article className="memory-billing__contact">
          <div><span>Custom</span></div>
          <strong>Contact us</strong>
          <p>For larger teams, custom limits, procurement, and support.</p>
          <ul><li>Volume pricing</li><li>Team onboarding</li><li>Custom usage limits</li></ul>
          <BookingLink variant="bare" ariaLabel="Talk to us about a custom Memory plan">
            Talk to us
          </BookingLink>
        </article>
      </div>

      <section className="memory-billing__invoices" aria-labelledby="memory-invoices-title">
        <header><div><span>Payments</span><h2 id="memory-invoices-title">Invoices</h2></div><small>{invoices.length} saved</small></header>
        {invoices.length ? (
          <div>
            {invoices.map((invoice) => (
              <article key={invoice.id}>
                <div><strong>{invoice.id}</strong><small>{formatDate(invoice.date)}</small></div>
                <span>{formatCredits(invoice.credits)} credits</span>
                <span className={`memory-invoice-status is-${invoice.status}`}>{invoice.status}</span>
                <strong>{formatCurrency(minorAmount(invoice), invoice.currency || summary?.currency)}</strong>
                <button type="button" onClick={() => setSelectedInvoice(invoice)}>Print</button>
              </article>
            ))}
          </div>
        ) : <p>No invoices yet.</p>}
      </section>

      {visibleReceipt ? (
        <BillingReceiptPrinter
          receipt={visibleReceipt}
          onClose={() => {
            setSelectedInvoice(null)
            if (receipt) onDismissReceipt()
          }}
        />
      ) : null}
    </section>
  )
}
