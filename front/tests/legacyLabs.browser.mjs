// Explicitly scoped shell regression; the scene workbench has its own canvas-graph case.
process.env.SHELL_INTERACTIONS_ONLY = '1'
process.env.SHELL_LAB_REGRESSION_ONLY = '1'
if (process.env.JELLYFISH_BROWSER_OUTPUT) process.env.SHELL_EVIDENCE_DIR = process.env.JELLYFISH_BROWSER_OUTPUT
await import('./shellAcceptance.browser.mjs')
