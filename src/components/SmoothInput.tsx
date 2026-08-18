import {
  forwardRef,
  type InputHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type CompositionEvent as ReactCompositionEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

export type SmoothInputProps = InputHTMLAttributes<HTMLInputElement> & {
  wrapperClassName?: string
}

const PASSWORD_CHAR =
  typeof navigator !== 'undefined' && /firefox|fxios/i.test(navigator.userAgent)
    ? '\u25CF'
    : '\u2022'

const SmoothInput = forwardRef<HTMLInputElement, SmoothInputProps>(function SmoothInput(
  {
    className = '',
    wrapperClassName = '',
    onBlur,
    onChange,
    onCompositionUpdate,
    onFocus,
    onKeyUp,
    onPointerUp,
    onSelect,
    style,
    type = 'text',
    value,
    ...props
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const updateCaretRef = useRef<(target: HTMLInputElement) => void>(() => undefined)
  const [caret, setCaret] = useState({ x: 0, visible: false })

  const setInputRef = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
    } else if (forwardedRef) {
      forwardedRef.current = node
    }
  }

  const syncMeasureSpan = () => {
    const input = inputRef.current
    const measure = measureRef.current
    if (!input || !measure) return

    const styles = window.getComputedStyle(input)
    let fontSize = styles.fontSize
    if (
      PASSWORD_CHAR === '\u2022' &&
      input.type === 'password' &&
      !/chrome|chromium|crios/i.test(navigator.userAgent)
    ) {
      fontSize = `${parseFloat(fontSize) + 6.25}px`
    }

    measure.style.font =
      `${styles.fontStyle} ${styles.fontWeight} ${fontSize} ${styles.fontFamily}`
    measure.style.letterSpacing = styles.letterSpacing
    measure.style.fontFeatureSettings = styles.fontFeatureSettings
    measure.style.fontVariationSettings = styles.fontVariationSettings
  }

  const measurePrefixWidth = (text: string) => {
    const input = inputRef.current
    const measure = measureRef.current
    if (!input || !measure) return null

    syncMeasureSpan()
    measure.textContent = text

    const styles = window.getComputedStyle(input)
    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    return text.length > 0 ? measure.offsetWidth + paddingLeft : paddingLeft - 1
  }

  const updateCaretFromInput = (target: HTMLInputElement) => {
    let selectionStart = 0
    let selectionEnd = 0

    try {
      selectionStart = target.selectionStart ?? target.value.length
      selectionEnd = target.selectionEnd ?? selectionStart
    } catch {
      setCaret((current) => ({ ...current, visible: false }))
      return
    }

    const hasSelection = selectionStart !== selectionEnd
    const caretIndex =
      hasSelection && target.selectionDirection !== 'backward'
        ? selectionEnd
        : selectionStart
    const textBeforeCaret =
      target.type === 'password'
        ? PASSWORD_CHAR.repeat(caretIndex)
        : target.value.slice(0, caretIndex)
    const absoluteWidth = measurePrefixWidth(textBeforeCaret)
    if (absoluteWidth === null) return

    const styles = window.getComputedStyle(target)
    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    const paddingRight = parseFloat(styles.paddingRight) || 0
    const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth)
    const visibleRight = target.scrollLeft + target.clientWidth - paddingRight
    const visibleLeft = target.scrollLeft + paddingLeft

    if (absoluteWidth > visibleRight) {
      target.scrollLeft = Math.min(
        absoluteWidth - target.clientWidth + paddingRight,
        maxScroll,
      )
    } else if (absoluteWidth < visibleLeft) {
      target.scrollLeft = Math.max(0, absoluteWidth - paddingLeft)
    }

    const caretPosition = target.clientLeft + absoluteWidth - target.scrollLeft
    const minX = target.clientLeft + paddingLeft - 1
    const maxX = target.clientLeft + target.clientWidth - paddingRight
    const visible = caretPosition >= minX && caretPosition <= maxX + 1

    setCaret({
      x: Math.min(Math.max(caretPosition, minX), maxX),
      visible: visible && !hasSelection && document.activeElement === target,
    })
  }

  updateCaretRef.current = updateCaretFromInput

  const scheduleCaretUpdate = (target: HTMLInputElement) => {
    requestAnimationFrame(() => updateCaretRef.current(target))
  }

  useEffect(() => {
    const input = inputRef.current
    if (input && document.activeElement === input) {
      scheduleCaretUpdate(input)
    }
  }, [type, value])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    const updateIfFocused = () => {
      if (document.activeElement === input) {
        updateCaretRef.current(input)
      }
    }
    const handleSelectionChange = () => scheduleCaretUpdate(input)
    const handleReset = () => requestAnimationFrame(updateIfFocused)

    document.addEventListener('selectionchange', handleSelectionChange)
    document.fonts?.addEventListener('loadingdone', updateIfFocused)
    void document.fonts?.ready.then(updateIfFocused)
    input.addEventListener('scroll', updateIfFocused)
    input.form?.addEventListener('reset', handleReset)

    const resizeObserver = new ResizeObserver(updateIfFocused)
    resizeObserver.observe(input)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.fonts?.removeEventListener('loadingdone', updateIfFocused)
      input.removeEventListener('scroll', updateIfFocused)
      input.form?.removeEventListener('reset', handleReset)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <span className={`smooth-input ${wrapperClassName}`.trim()}>
      <input
        {...props}
        ref={setInputRef}
        type={type}
        value={value}
        className={`smooth-input__field ${className}`.trim()}
        style={{ ...style, caretColor: 'transparent' }}
        onChange={(event) => {
          onChange?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
        onFocus={(event) => {
          onFocus?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
        onBlur={(event) => {
          setCaret((current) => ({ ...current, visible: false }))
          onBlur?.(event)
        }}
        onSelect={(event) => {
          onSelect?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
        onKeyUp={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          onKeyUp?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLInputElement>) => {
          onPointerUp?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
        onCompositionUpdate={(event: ReactCompositionEvent<HTMLInputElement>) => {
          onCompositionUpdate?.(event)
          scheduleCaretUpdate(event.currentTarget)
        }}
      />
      <span ref={measureRef} className="smooth-input__measure" aria-hidden="true" />
      <span
        className={caret.visible ? 'smooth-input__caret' : 'smooth-input__caret is-hidden'}
        style={{ transform: `translate3d(${caret.x}px, -50%, 0)` }}
        aria-hidden="true"
      />
    </span>
  )
})

export default SmoothInput
