// Progressive enhancement: without JavaScript every preview remains readable.
const showcase = document.querySelector('.jf-showcase');
if (showcase) {
  const controls = showcase.querySelector('.jf-preview-controls');
  const buttons = [...controls.querySelectorAll('button')];
  const previews = [...showcase.querySelectorAll('[data-preview]')];
  const status = showcase.querySelector('[data-preview-status]');
  const selectPreview = (index) => {
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    previews.forEach((preview, i) => { preview.hidden = i !== index; });
  };
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    selectPreview(index);
    status.textContent = `${button.textContent.trim()}：${previews[index].querySelector('.jf-preview-caption').textContent}`;
  }));
  selectPreview(0);
  controls.hidden = false;
}
