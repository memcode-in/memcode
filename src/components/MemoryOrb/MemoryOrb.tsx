import { DotSphere } from './DotSphere'

export type MemoryOrbProps = {
  size?: number;
  className?: string;
  /** Outer blur in px (default 0). */
  blur?: number;
  /** Enable dot wave animation (default true). */
  animate?: boolean;
}

function buildGlow(size: number) {
  const u = size / 30;
  const g = '47,125,255'
  return [
    `0 0 ${6 * u}px rgba(${g},0.08)`,
    `0 0 ${18 * u}px rgba(${g},0.04)`,
  ].join(', ')
}

export function MemoryOrb({
  size = 200,
  className = '',
  blur = 0,
  animate = true,
}: MemoryOrbProps) {
  return (
    <span
      className={`memory-orb ${className}`.trim()}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
      }}
    >
      <span
        className="memory-orb__surface"
        style={{
          width: size,
          height: size,
          boxShadow: buildGlow(size),
          background: `radial-gradient(circle at 38% 32%, #0a1730 0%, #040914 55%, #02040a 100%)`,
        }}
      >
        <DotSphere size={size} animate={animate} />
      </span>
    </span>
  )
}

export default MemoryOrb
