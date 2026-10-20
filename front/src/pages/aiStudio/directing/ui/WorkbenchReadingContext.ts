import { createContext } from 'react'

/** 详情和操作内的辅助只读内容就地阅读，不再叠加大型窗口。 */
export const WorkbenchReadingContext = createContext(false)
