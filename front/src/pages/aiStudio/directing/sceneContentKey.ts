/** 输入可省略 nullable／空列表默认值；比较业务值并保留数组顺序。 */
export const sceneContentKey = (value: unknown) => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  return Object.fromEntries(Object.keys(item).sort()
    .filter(key => item[key] !== null && item[key] !== undefined && !(Array.isArray(item[key]) && item[key].length === 0 && key !== 'participant_ids'))
    .map(key => [key, item[key]]))
})
