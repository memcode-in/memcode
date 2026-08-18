export interface RazorpayOrder {
  id?: string
  order_id?: string
  amount: number
  currency: string
  key_id?: string
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string
  razorpay_order_id?: string
  razorpay_signature: string
}

export interface RazorpayPaymentFailedResponse {
  error?: {
    description?: string
    reason?: string
  }
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill?: {
    name?: string
    email?: string
  }
  notes?: Record<string, string>
  theme?: {
    color?: string
  }
  handler: (response: RazorpaySuccessResponse) => void
  modal?: {
    ondismiss?: () => void
  }
}

type RazorpayConstructor = new (options: RazorpayOptions) => {
  open: () => void
  on: (
    event: 'payment.failed',
    handler: (response: RazorpayPaymentFailedResponse) => void,
  ) => void
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

let razorpayScriptPromise: Promise<void> | null = null

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (razorpayScriptPromise) return razorpayScriptPromise

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      razorpayScriptPromise = null
      reject(new Error('Failed to load Razorpay Checkout.'))
    }
    document.body.appendChild(script)
  })

  return razorpayScriptPromise
}
