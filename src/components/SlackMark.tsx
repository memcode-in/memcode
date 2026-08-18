interface SlackMarkProps {
  size?: number
}

export default function SlackMark({ size = 18 }: SlackMarkProps) {
  return (
    <img
      src="/brands/slack.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
    />
  )
}
