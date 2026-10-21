import { Children } from 'react'
import type { ReactNode } from 'react'
import { EnvironmentOutlined, FolderAddOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'
import { GraphCanvas } from './GraphCanvas'
import type { GraphCanvasGuide, GraphCanvasObject, GraphCanvasProps, GraphCanvasRelation } from './GraphCanvas'
import { directorGroup, directorGroups, fixedDirectorSize } from './directorLayout'
import { directorRelationCategory } from './directorRelations'
import { directorLayoutScope } from './directorLayoutAdapter'
import type { DirectorLayoutScope } from './directorLayoutAdapter'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export type DirectorCanvasObject = GraphCanvasObject
export type DirectorCanvasRelation = GraphCanvasRelation
export type DirectorCanvasGuide = GraphCanvasGuide
const defaultLabels = ['原文依据', '全场共享', '镜头设计']
type Props = Omit<GraphCanvasProps, 'objects' | 'layoutScope' | 'fallbackLayout'> & {
  children: ReactNode; objects?: DirectorCanvasObject[]; layoutScope?: DirectorLayoutScope
  inspectors?: Record<string, ((trigger: HTMLElement) => void) | undefined>
  anchorTitle?: string; labels?: string[]
}

/** 导演排布与旧固定卡片适配；通用绘制、聚焦和视口交给共同图容器。 */
export function DirectorCanvasSurface({ children, objects = [], layoutScope, inspectors = {},
  labels = defaultLabels, anchorTitle, tools = [], relations = [], groups, focusTarget,
  ariaLabel = '导演画布视口', toolsLabel = '导演画布工具', ...props }: Props) {
  const childrenNodes: DirectorCanvasObject[] = Children.toArray(children).map((content, index) => ({
    id: layoutScope && index === 2 && layoutScope.anchorId !== '全场共享' ? layoutScope.anchorId : labels[index],
    label: labels[index], title: index === 2 ? anchorTitle : undefined, content, onInspect: inspectors[labels[index]],
  }))
  const nodes = [...childrenNodes, ...objects].map(node => ({ ...node,
    title: layoutScope && node.id === '全场共享' ? '全场概览' : node.title,
    group: node.group || directorGroup(node.id),
    size: layoutScope ? node.size || fixedDirectorSize(node.id) : node.size,
  }))
  const fallbackLayout = (rows: GraphCanvasObject[], sizes: Record<string, { width: number; height: number }>) => {
    const height = (id: string) => sizes[id]?.height || 260
    const shotTop = height(labels[1]) + 72
    const positions: Record<string, CanvasPoint> = {
      [labels[0]]: { x: 0, y: 0 }, [labels[1]]: { x: 400, y: 0 }, [labels[2]]: { x: 400, y: shotTop },
    }
    let leftTop = Math.max(shotTop, height(labels[0]) + 72), rightTop = shotTop
    rows.slice(childrenNodes.length).forEach(node => {
      const left = /^(participant|location|performance|situation|activity|dialogue):/.test(node.id)
      positions[node.id] = { x: left ? 0 : 800, y: left ? leftTop : rightTop }
      if (left) leftTop += height(node.id) + 64
      else rightTop += height(node.id) + 64
    })
    return positions
  }
  const focus = focusTarget && layoutScope && focusTarget.nodeId === '镜头设计' && !nodes.some(node => node.id === focusTarget.nodeId)
    ? { ...focusTarget, nodeId: layoutScope.anchorId } : focusTarget
  return <GraphCanvas {...props} objects={nodes} ariaLabel={ariaLabel} toolsLabel={toolsLabel}
    layoutScope={layoutScope && directorLayoutScope({ ...layoutScope, initialTop: 64 })}
    fallbackLayout={layoutScope ? undefined : fallbackLayout} focusTarget={focus}
    groups={groups || Object.entries(directorGroups).map(([id, label]) => ({ id, label }))}
    relations={relations.map(relation => ({ ...relation, category: relation.category || directorRelationCategory(relation.label) }))}
    tools={tools.map(tool => ({ ...tool, icon: tool.icon || (tool.label === '角色工具' ? <UserOutlined />
      : tool.label === '场所工具' ? <EnvironmentOutlined /> : tool.label === '关联项目资产' ? <FolderAddOutlined /> : <ToolOutlined />) }))} />
}
