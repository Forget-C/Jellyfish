import type { InstructionInputs_Output, SceneVideoPreparation_Output } from '../../../services/generated'

// 服务端返回的实际输入按业务值比较，JSON 对象字段顺序不影响适用性。
const inputKey = (value: InstructionInputs_Output) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** 生成依据一致仍不代表素材覆盖动作或已经通过人工审片。 */
export function videoInputsMatch(preparation: SceneVideoPreparation_Output, current: InstructionInputs_Output, instruction: string) {
  return instruction === preparation.request.execution_prompt && inputKey(current) === inputKey(preparation.inputs)
}
