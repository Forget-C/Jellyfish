const phaseLabels = new Map([['video', '画面／视频'], ['sound', '声音'], ['postproduction', '后期']])

/** 旧阶段值只转换显示，不因查看或打开编辑器改写已保存数据。 */
export const designPhaseLabel = (value?: string | null) => phaseLabels.get(value || '') || value || ''
