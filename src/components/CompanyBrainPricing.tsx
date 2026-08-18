import type { ReactNode } from 'react'
import BookingLink from './marketing/BookingLink'

export interface CompanyBrainPlan {
  id: 'company-brain' | 'company-brain-plus'
  packageId: 'company-brain-monthly' | 'company-brain-plus-monthly'
  name: string
  description: string
  featured?: boolean
  amount: number
  features: readonly string[]
}

export const COMPANY_BRAIN_PLANS: ReadonlyArray<CompanyBrainPlan> = [
  {
    id: 'company-brain',
    packageId: 'company-brain-monthly',
    name: 'Company Brain',
    description: 'One shared, reliable memory layer for your company and the AI tools your team already uses.',
    amount: 20000,
    features: [
      'Slack company memory and public-history import',
      'Provider-neutral connected-app framework',
      '200 Firecrawl credits every month',
      'Organization-scoped usage and billing controls',
      'Managed onboarding and priority support',
      'One-time $50 Codex credit arranged during onboarding',
    ],
  },
  {
    id: 'company-brain-plus',
    packageId: 'company-brain-plus-monthly',
    name: 'Company Brain Plus',
    description: 'More capacity and hands-on support for teams making Company Brain part of their daily workflow.',
    featured: true,
    amount: 30000,
    features: [
      'Slack company memory and public-history import',
      'Provider-neutral connected-app framework',
      'Codex, Claude Code, Cursor, and custom MCP access',
      '250 Firecrawl credits every month',
      'Higher usage limits for growing teams',
      'Priority adapter and workflow setup',
      'Organization-scoped usage and billing controls',
      'Managed onboarding and priority support',
      'One-time $50 Codex credit arranged during onboarding',
    ],
  },
]

const CUSTOM_PLAN_FEATURES = [
  'Everything in Company Brain Plus',
  'Custom usage and connector limits',
  'Security and procurement support',
  'Dedicated onboarding and workflows',
  'One-time $50 Codex credit arranged during onboarding',
] as const

function formatUsd(amountInCents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amountInCents / 100)
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="m5 10 3 3 7-7" />
    </svg>
  )
}

function CompanyBrainPlanCard({
  plan,
  action,
}: {
  plan: CompanyBrainPlan
  action: ReactNode
}) {
  return (
    <article className={`dashboard-plan ${plan.featured ? 'dashboard-plan--featured' : ''}`}>
      <h3>{plan.name}</h3>
      <div className="dashboard-plan__price">
        <strong>{formatUsd(plan.amount)}</strong>
        <span>/1 month access</span>
      </div>
      <p>{plan.description}</p>
      <small className="dashboard-plan__saving">One-time payment · 1 month of access</small>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {action}
    </article>
  )
}

export default function CompanyBrainPricing({
  renderPlanAction,
  giftTitleId = 'company-brain-gift-title',
}: {
  renderPlanAction: (plan: CompanyBrainPlan) => ReactNode
  giftTitleId?: string
}) {
  return (
    <>
      <div className="dashboard-pricing__grid">
        {COMPANY_BRAIN_PLANS.map((plan) => (
          <CompanyBrainPlanCard
            key={plan.id}
            plan={plan}
            action={renderPlanAction(plan)}
          />
        ))}

        <article className="dashboard-plan dashboard-plan--custom">
          <h3>Need even more?</h3>
          <div className="dashboard-plan__price">
            <strong>Contact us</strong>
          </div>
          <p>Tell us about your team, connectors, security needs, and expected usage. We’ll shape a Company Brain plan around you.</p>
          <small className="dashboard-plan__saving">Volume pricing and dedicated support</small>
          <ul>
            {CUSTOM_PLAN_FEATURES.map((feature) => (
              <li key={feature}><CheckIcon /><span>{feature}</span></li>
            ))}
          </ul>
          <BookingLink className="dashboard-plan__button" variant="bare" ariaLabel="Talk to us about custom Company Brain pricing">
            Talk to us
          </BookingLink>
        </article>
      </div>

      <section className="dashboard-pricing__gift" aria-labelledby={giftTitleId}>
        <div className="dashboard-pricing__gift-message">
          <h3 id={giftTitleId}>Every paid plan includes <span>$50 in Codex credit.</span></h3>
          <p>A small token of gratitude for trusting us with your company’s memory.</p>
        </div>
        <div className="dashboard-pricing__gift-details">
          <strong>Included after payment verification</strong>
          <p>Your one-time Codex credit is arranged during managed onboarding for the new Company Brain account.</p>
        </div>
      </section>
    </>
  )
}
