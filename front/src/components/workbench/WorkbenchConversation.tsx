import { Bubble, type BubbleListProps } from '@ant-design/x'

/** Shared chat rendering without changing the caller's scroll and focus ownership. */
export function WorkbenchConversation({ items, gap = 8 }: {
  items: BubbleListProps['items']
  gap?: number
}) {
  return <Bubble.List items={items} autoScroll={false} styles={{ root: { gap } }} />
}
