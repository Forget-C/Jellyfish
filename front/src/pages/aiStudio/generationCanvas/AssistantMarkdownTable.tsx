import { Children, Fragment, isValidElement, type ReactNode } from 'react'

function elements(children: ReactNode) {
  return Children.toArray(children).filter(isValidElement<{ children?: ReactNode }>)
}

/** In a drawer, wide shot lists read better as one labeled record per row. */
export function AssistantMarkdownTable({ children }: { children?: ReactNode }) {
  const sections = elements(children)
  const head = sections.find(section => section.type === 'thead')
  const body = sections.find(section => section.type === 'tbody')
  const headings = elements(elements(head?.props.children)[0]?.props.children)
  if (!body || headings.length <= 5) return <table>{children}</table>

  return <div className="canvas-assistant-table-records">{elements(body.props.children).map(row =>
    <dl key={row.key}>{elements(row.props.children).map((cell, index) =>
      <Fragment key={cell.key}>
        <dt>{headings[index]?.props.children}</dt>
        <dd>{cell.props.children}</dd>
      </Fragment>,
    )}</dl>,
  )}</div>
}
