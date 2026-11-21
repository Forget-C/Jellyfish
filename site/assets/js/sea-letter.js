const stages = document.querySelectorAll('[data-select]')

for (const button of stages) {
  button.addEventListener('click', () => {
    stages.forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)))
    document.querySelectorAll('[data-stage]').forEach(panel => { panel.hidden = panel.dataset.stage !== button.dataset.select })
  })
}

const board = document.querySelector('.flow-board')
const wires = [...board.querySelectorAll('path')]
const nodes = board.querySelectorAll('[data-note]')

function drawConnections() {
  const bounds = board.querySelector('svg').getBoundingClientRect()
  const stacked = matchMedia('(max-width: 820px)').matches
  for (const path of wires) {
    const from = document.getElementById(path.dataset.from).getBoundingClientRect()
    const to = document.getElementById(path.dataset.to).getBoundingClientRect()
    const x = from.right - bounds.left
    const y = from.top + from.height / 2 - bounds.top
    const endX = to.left - bounds.left
    const endY = to.top + to.height / 2 - bounds.top
    let d
    if (!stacked) {
      const mid = (x + endX) / 2
      d = `M${x} ${y} C${mid} ${y} ${mid} ${endY} ${endX} ${endY}`
    } else if (path.dataset.from === 'references') {
      d = `M${endX} ${y} H12 V${endY} H${endX}`
    } else {
      const center = endX + to.width / 2
      d = `M${center} ${from.bottom - bounds.top} V${to.top - bounds.top}`
    }
    path.setAttribute('d', d)
  }
}
const layoutObserver = new ResizeObserver(drawConnections)
layoutObserver.observe(board)
board.querySelectorAll('.flow-card').forEach(card => layoutObserver.observe(card))
for (const node of nodes) {
  node.addEventListener('click', () => {
    nodes.forEach(button => button.setAttribute('aria-pressed', String(button === node)))
    const source = node.closest('.flow-card').id
    wires.forEach(path => path.classList.toggle('is-active', path.dataset.from === source))
    document.querySelector('.flow-caption p').textContent = node.dataset.note
  })
}
