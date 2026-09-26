import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { AppstoreOutlined, SettingOutlined } from '@ant-design/icons'

/**
 * 多选时的**维护**工具条。
 *
 * 第三部分：工作室只做单镜补漏——整集批量生成与批量导入留在项目第 3 步
 * 「整集视频提示词」，因此这里不再有「批量生成」「批量视频准备度」两个入口，
 * 只保留合并 / 隐藏 / 删除 / 提取维护这些结构性动作。
 */
type ChapterStudioBatchToolbarProps = {
  selectedCount: number
  maintenanceMenuItems: MenuProps['items']
}

export function ChapterStudioBatchToolbar({
  selectedCount,
  maintenanceMenuItems,
}: ChapterStudioBatchToolbarProps) {
  return (
    <div className="cs-group m-3 mt-0 mb-2">
      <div className="cs-group-title mb-1 flex items-center gap-2">
        <AppstoreOutlined /> 多选维护
      </div>
      <div className="mb-2 text-xs text-gray-500">
        已选 {selectedCount} 条分镜，可继续按{' '}
        <span className="font-medium text-gray-700">Command/Ctrl + 点击</span>{' '}
        调整选择；生成与导出仍按单镜进行。
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Dropdown menu={{ items: maintenanceMenuItems }} trigger={['click']}>
          <Button size="small" icon={<SettingOutlined />}>
            维护动作
          </Button>
        </Dropdown>
      </div>
    </div>
  )
}
