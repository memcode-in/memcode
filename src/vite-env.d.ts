/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEMORY_API_URL?: string
  readonly VITE_MEMCODE_BRAIN_API_URL?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_RAZORPAY_KEY_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
