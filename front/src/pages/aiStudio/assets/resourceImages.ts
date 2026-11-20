import { StudioEntitiesService, type AssetViewAngle } from '../../../services/generated'
import type { ResourceKind } from './components/ResourceEditorDrawer'

export type ResourcePicture = {
  id: number; file_id?: string | null; view_angle?: AssetViewAngle; is_primary?: boolean; is_view_default?: boolean
}

/** 文件夹和来源选图共用完整图片集合，主图不能因落在下一页而丢失。 */
export async function readResourceImages(kind: ResourceKind, id: string): Promise<ResourcePicture[]> {
  const images: ResourcePicture[] = []
  for (let page = 1; ; page++) {
    const response = await StudioEntitiesService.listEntityImagesApiV1StudioEntitiesEntityTypeEntityIdImagesGet({
      entityType: kind, entityId: id, page, pageSize: 100,
    })
    const rows = (response.data?.items ?? []) as ResourcePicture[]
    images.push(...rows)
    if (!rows.length || images.length >= (response.data?.pagination.total ?? images.length)) return images
  }
}
