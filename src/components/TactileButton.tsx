import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type TactileButtonDepth = 'shallow' | 'deep'
type TactileButtonSize = 'sm' | 'md'

interface TactileButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode
  depth?: TactileButtonDepth
  size?: TactileButtonSize
}

export function TactileButton({
  children,
  className,
  depth = 'deep',
  size = 'md',
  ...props
}: TactileButtonProps) {
  return (
    <a
      className={cn(
        'tactile-button inline-flex items-center justify-center gap-1.5 rounded-lg border border-grayscale-12/15 bg-grayscale-2 font-medium text-grayscale-12 no-underline transition-[transform,box-shadow,background-color] duration-100 hover:bg-grayscale-1 active:translate-y-px dark:border-grayscale-1/15 dark:bg-grayscale-11 dark:text-grayscale-1 dark:hover:bg-grayscale-12',
        depth === 'shallow'
          ? 'shadow-[0_2px_0_var(--color-grayscale-4),inset_0_1px_0_rgba(255,255,255,0.8)] active:shadow-[0_1px_0_var(--color-grayscale-4),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_2px_0_var(--color-grayscale-12),inset_0_1px_0_rgba(255,255,255,0.08)] dark:active:shadow-[0_1px_0_var(--color-grayscale-12),inset_0_1px_0_rgba(255,255,255,0.08)]'
          : 'shadow-[0_4px_0_var(--color-grayscale-4),inset_0_1px_0_rgba(255,255,255,0.8)] active:shadow-[0_2px_0_var(--color-grayscale-4),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_4px_0_var(--color-grayscale-12),inset_0_1px_0_rgba(255,255,255,0.08)] dark:active:shadow-[0_2px_0_var(--color-grayscale-12),inset_0_1px_0_rgba(255,255,255,0.08)]',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
}
