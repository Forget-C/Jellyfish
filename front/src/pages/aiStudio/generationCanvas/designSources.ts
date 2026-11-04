/** Prefer ordinary media candidates; retain local-example ports when no ordinary port exists. */
export function designMediaSourcePorts(ports: string[]): string[] {
  const result = new Map<string, string>()
  for (const port of ports) {
    const modality = port.replace(/_example$/, '')
    if (!['image', 'video', 'audio', 'first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video'].includes(modality)) continue
    if (!result.has(modality) || port === modality) result.set(modality, port)
  }
  return [...result.values()]
}
