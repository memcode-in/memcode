import { cn } from '../../lib/utils'
import { ImagesBadge } from './images-badge'

interface MemoryFolderProps {
  title: string
  domain: string
  summary: string
  date: string
  selected?: boolean
  onOpen: () => void
}

const MEMORY_PREVIEWS = [
  '/images/memory-sheet-context.svg',
  '/images/memory-sheet-links.svg',
  '/images/memory-sheet-notes.svg',
]

const FOLDER_SIZE = { width: 112, height: 84 }
const TEASER_SIZE = { width: 68, height: 46 }
const HOVER_SIZE = { width: 116, height: 78 }

export function MemoryFolder({
  title,
  domain,
  summary,
  date,
  selected = false,
  onOpen,
}: MemoryFolderProps) {
  return (
    <button
      type="button"
      className={cn('memory-folder', selected && 'is-selected')}
      aria-label={`Open memory: ${title}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="memory-folder__hover-area">
        <ImagesBadge
          text={title}
          images={MEMORY_PREVIEWS}
          className="memory-folder__badge"
          folderSize={FOLDER_SIZE}
          teaserImageSize={TEASER_SIZE}
          hoverImageSize={HOVER_SIZE}
          hoverTranslateY={-76}
          hoverSpread={46}
          hoverRotation={13}
        />
      </span>
      <span className="memory-folder__meta">
        <span>{domain}</span>
        <i aria-hidden="true" />
        <time>{date}</time>
      </span>
      <span className="sr-only">{summary}</span>
    </button>
  )
}
