/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 局部更新Scene，未传字段保持原值。
 */
export type SceneUpdate = {
    references?: Array<AssetPromptReference>;
    name?: (string | null);
    tags?: (Array<string> | null);
    prompt_template_id?: (string | null);
    view_count?: (number | null);
    style?: (ProjectStyle | null);
    visual_style?: (ProjectVisualStyle | null);
    /**
     * 补充信息
     */
    supplementary_info?: string;
    /**
     * 场所类型
     */
    scene_type?: (string | null);
    /**
     * 空间布局
     */
    spatial_layout?: (string | null);
    /**
     * 环境特征
     */
    environment_features?: (string | null);
    /**
     * 主要材质
     */
    materials?: (string | null);
    /**
     * 色彩
     */
    color_palette?: (string | null);
};

