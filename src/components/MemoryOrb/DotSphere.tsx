import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type DotSphereProps = {
  size: number;
  animate?: boolean;
}

type Dot = {
  cx: number;
  cy: number;
  baseR: number;
  baseOpacity: number;
  row: number;
  col: number;
  dist: number;
  hue: number;
}

const BRIGHT = [157, 204, 255] as const
const MID = [105, 167, 255] as const
const DIM = [24, 62, 130] as const

function lerp3(a: readonly number[], b: readonly number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  return `rgb(${r},${g},${bl})`
}

function dotColor(light: number): string {
  if (light > 0.5) return lerp3(MID, BRIGHT, (light - 0.5) * 2)
  return lerp3(DIM, MID, light * 2)
}

function buildDots(size: number): Dot[] {
  const dots: Dot[] = []
  const radius = size / 2
  const rows = Math.round(size / 8.8)
  const rowSpacing = size / rows
  const colSpacing = rowSpacing * 0.64

  for (let ri = 0; ri < rows; ri++) {
    const cy = rowSpacing * 0.5 + ri * rowSpacing
    const ny = (cy - radius) / radius

    const rowWidth = Math.sqrt(Math.max(0, 1 - ny * ny)) * radius
    if (rowWidth < colSpacing * 0.3) continue

    const cols = Math.floor((rowWidth * 2) / colSpacing)
    const startX = radius - (cols * colSpacing) / 2 + colSpacing * 0.5

    for (let ci = 0; ci < cols; ci++) {
      const cx = startX + ci * colSpacing
      const nx = (cx - radius) / radius
      const distSq = nx * nx + ny * ny
      const dist = Math.sqrt(distSq)

      const z = dist <= 1 ? Math.sqrt(1 - distSq) : 0
      const lightX = -0.52
      const lightY = -0.48
      const light = Math.max(0, nx * lightX + ny * lightY + z * 0.82)

      const edgeFade = dist > 0.88 ? 1 - (dist - 0.88) / 0.22 : 1
      const clampedFade = Math.max(0, Math.min(1, edgeFade))

      const maxR = (size / 200) * 3.8
      const minR = (size / 200) * 0.5
      const baseR = minR + light * (maxR - minR)

      const baseOpacity = (0.08 + light * 0.92) * clampedFade

      if (baseOpacity < 0.02) continue

      dots.push({
        cx,
        cy,
        baseR,
        baseOpacity,
        row: ri,
        col: ci,
        dist,
        hue: light,
      })
    }
  }

  return dots
}

/** Canvas-rendered halftone dot sphere with wave animation. */
export const DotSphere = memo(function DotSphere({
  size,
  animate = true,
}: DotSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number>(0)
  const dots = useMemo(() => buildDots(size), [size])
  const [reduceMotion, setReduceMotion] = useState(false)
  const shouldAnimate = animate && !reduceMotion

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReduceMotion(media.matches)
    syncPreference()
    media.addEventListener('change', syncPreference)
    return () => media.removeEventListener('change', syncPreference)
  }, [])

  const draw = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const pixelSize = Math.round(size * dpr)
      if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
        canvas.width = pixelSize
        canvas.height = pixelSize
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }

      ctx.clearRect(0, 0, size, size)

      if (!startRef.current) startRef.current = time
      const elapsed = (time - startRef.current) / 1000

      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i]

        let pulse = 1
        if (shouldAnimate) {
          const wavePhase = dot.row * 0.18 + dot.col * 0.06 + elapsed * 1.8
          pulse = 0.82 + 0.18 * Math.sin(wavePhase)

          const shimmer = Math.sin(elapsed * 0.7 + dot.dist * 4.5) * 0.12
          pulse += shimmer
          pulse = Math.max(0.55, Math.min(1.15, pulse))
        }

        const r = dot.baseR * pulse
        const opacity = dot.baseOpacity * (0.85 + pulse * 0.15)
        const color = dotColor(dot.hue * pulse)

        ctx.globalAlpha = Math.min(1, opacity)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(dot.cx, dot.cy, Math.max(0.3, r), 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1

      if (shouldAnimate) {
        rafRef.current = requestAnimationFrame(draw)
      }
    },
    [dots, shouldAnimate, size],
  )

  useEffect(() => {
    startRef.current = 0
    if (shouldAnimate) {
      rafRef.current = requestAnimationFrame(draw)
    } else {
      draw(0)
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [draw, shouldAnimate])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="memory-orb__canvas"
      style={{ width: size, height: size }}
    />
  )
})
