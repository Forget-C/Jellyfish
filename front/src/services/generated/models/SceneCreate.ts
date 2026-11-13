/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建Scene，只接收该类别的可编辑设定。
 */
export type SceneCreate = {
    adopt_reference?: (AssetPromptReference | null);
    references?: Array<AssetPromptReference>;
    id: string;
    name: string;
    tags?: Array<string>;
    prompt_template_id?: (string | null);
    view_count?: number;
    style?: ProjectStyle;
    visual_style?: ProjectVisualStyle;
    /**
     * 所属项目；不传时创建共享资产
     */
    project_id?: (string | null);
    /**
     * 可选：章节 ID
     */
    chapter_id?: (string | null);
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
