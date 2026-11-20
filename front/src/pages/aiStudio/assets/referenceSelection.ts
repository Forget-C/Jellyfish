import type { ResourcePicture } from './resourceImages'

/** 按生成角度取默认图；该角度无默认图时回退主图，相同文件只保留一次。 */
export function resolveReferencePictures(images: ResourcePicture[], angles: readonly string[]): ResourcePicture[] {
  const primary = images.find(image => image.is_primary && image.file_id)
  const result: ResourcePicture[] = []
  for (const angle of angles) {
    const picture = images.find(image => image.view_angle === angle && image.is_view_default && image.file_id) ?? primary
    if (picture?.file_id && !result.some(item => item.file_id === picture.file_id)) result.push(picture)
  }
  return result
}
