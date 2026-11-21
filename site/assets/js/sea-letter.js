const stages = document.querySelectorAll('[data-select]')

for (const button of stages) {
  button.addEventListener('click', () => {
    stages.forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)))
    document.querySelectorAll('[data-stage]').forEach(panel => { panel.hidden = panel.dataset.stage !== button.dataset.select })
  })
}
