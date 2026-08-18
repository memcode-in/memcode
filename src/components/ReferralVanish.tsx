import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

interface ReferralVanishProps {
  id: string
  label: string
  description: ReactNode
  disabled?: boolean
  isSubmitting?: boolean
  onApply: (code: string) => void | Promise<void>
}

interface VanishParticle {
  x: number
  y: number
  size: number
  driftX: number
  driftY: number
  delay: number
}

const ANIMATION_DURATION_MS = 560

export default function ReferralVanish({
  id,
  label,
  description,
  disabled = false,
  isSubmitting = false,
  onApply,
}: ReferralVanishProps) {
  const [value, setValue] = useState('')
  const [animating, setAnimating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | null>(null)

  const finishAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    setAnimating(false)
  }, [])

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  const animateText = useCallback(() => {
    const input = inputRef.current
    const canvas = canvasRef.current
    if (!input || !canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false
    }

    const particles = captureTextParticles(input, canvas)
    if (particles.length === 0) return false

    const context = canvas.getContext('2d')
    if (!context) return false

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const color = window.getComputedStyle(input).color
    const startedAt = performance.now()
    setAnimating(true)

    const drawFrame = (now: number) => {
      const elapsed = now - startedAt
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.fillStyle = color

      for (const particle of particles) {
        const progress = Math.max(0, Math.min(1, (elapsed - particle.delay) / 360))
        if (progress >= 1) continue
        const eased = 1 - (1 - progress) ** 3
        context.globalAlpha = (1 - progress) ** 1.6
        context.fillRect(
          particle.x + particle.driftX * eased,
          particle.y + particle.driftY * eased,
          Math.max(0.35, particle.size * (1 - eased * 0.7)),
          Math.max(0.35, particle.size * (1 - eased * 0.7)),
        )
      }

      context.globalAlpha = 1
      if (elapsed < ANIMATION_DURATION_MS) {
        animationFrameRef.current = window.requestAnimationFrame(drawFrame)
      } else {
        finishAnimation()
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(drawFrame)
    return true
  }, [finishAnimation])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = value.trim()
    if (!code || disabled || isSubmitting || animating) return

    animateText()
    setValue('')
    void onApply(code)
  }

  const inputDisabled = disabled || isSubmitting

  return (
    <form className="oauth-referral dashboard-pricing__referral" onSubmit={submit}>
      <div className="dashboard-pricing__referral-copy">
        <label htmlFor={id}>{label}</label>
        <small>{description}</small>
      </div>
      <div className="oauth-referral__row referral-vanish__row">
        <div className={`referral-vanish__field${animating ? ' is-animating' : ''}`}>
          <canvas ref={canvasRef} className="referral-vanish__canvas" aria-hidden="true" />
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder="Enter code"
            disabled={inputDisabled}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn--ghost"
          disabled={inputDisabled || animating || !value.trim()}
        >
          {isSubmitting ? 'Applying…' : 'Apply code'}
        </button>
      </div>
    </form>
  )
}

function captureTextParticles(input: HTMLInputElement, canvas: HTMLCanvasElement) {
  const width = input.clientWidth
  const height = input.clientHeight
  if (width <= 0 || height <= 0) return []

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []

  const styles = window.getComputedStyle(input)
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.font = styles.font
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.fillText(input.value, paddingLeft, height / 2)

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const step = Math.max(2, Math.round(2 * pixelRatio))
  const particles: VanishParticle[] = []

  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if ((image.data[(y * canvas.width + x) * 4 + 3] ?? 0) < 96) continue
      const cssX = x / pixelRatio
      const cssY = y / pixelRatio
      const direction = Math.random() > 0.5 ? 1 : -1
      particles.push({
        x: cssX,
        y: cssY,
        size: Math.max(0.75, step / pixelRatio),
        driftX: 7 + Math.random() * 15,
        driftY: direction * (2 + Math.random() * 8),
        delay: Math.max(0, 150 - (cssX / width) * 150) + Math.random() * 35,
      })
    }
  }

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  return particles
}
