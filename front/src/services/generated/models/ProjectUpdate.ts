/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
export type ProjectUpdate = {
    /**
     * 源图片 ID，保存时克隆；显式 null 恢复默认，省略保留当前封面
     */
    cover_file_id?: (string | null);
    name?: (string | null);
    description?: (string | null);
    /**
     * 题材/风格
     */
    style?: (ProjectStyle | null);
    visual_style?: (ProjectVisualStyle | null);
    seed?: (number | null);
    unify_style?: (boolean | null);
    progress?: (number | null);
    default_video_ratio?: (string | null);
    stats?: (Record<string, any> | null);
};

