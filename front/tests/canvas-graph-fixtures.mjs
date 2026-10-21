/** 展示地址全部改名，业务 object／record／shot／unit 身份保持原样。 */
export function opaqueCanvasAddresses(graph) {
  const addresses = (items, prefix) => Object.fromEntries(items.map((item, index) => [item.id, `${graph.kind}-${prefix}-${index + 1}`]))
  return { nodes: addresses(graph.nodes, 'node'), edges: addresses(graph.edges, 'edge'), views: addresses(graph.views, 'view') }
}

/** 连同来源、问题与跨画布目标一起改名，避免夹具制造不闭合的假故障。 */
export function remapCanvasGraph(graph, { nodes = {}, edges = {}, views = {}, externalNodes = {} }) {
  const address = target => {
    if (!target) return
    if (!target.external) target.node_id = nodes[target.node_id] || target.node_id
    else if (target.object.version_id === graph.version_id && target.object.revision === graph.revision) target.node_id = externalNodes[target.node_id] || target.node_id
  }
  for (const node of graph.nodes) {
    node.id = nodes[node.id] || node.id
    node.home_view_id = views[node.home_view_id] || node.home_view_id
    address(node.edit_target)
    node.sources.forEach(address)
    node.issues.forEach(issue => address(issue.target))
    node.field_targets?.forEach(row => address(row.target))
  }
  for (const edge of graph.edges) {
    edge.id = edges[edge.id] || edge.id
    edge.source = nodes[edge.source] || edge.source
    edge.target = nodes[edge.target] || edge.target
    edge.sources.forEach(address)
  }
  for (const view of graph.views) {
    view.id = views[view.id] || view.id
    view.parent_id = views[view.parent_id] || view.parent_id
    view.anchor_id = nodes[view.anchor_id] || view.anchor_id
    view.edge_ids = view.edge_ids.map(id => edges[id] || id)
    for (const member of view.members) {
      member.node_id = nodes[member.node_id] || member.node_id
      member.entry_view_id = views[member.entry_view_id] || member.entry_view_id
    }
  }
  graph.issues.forEach(issue => address(issue.target))
}
