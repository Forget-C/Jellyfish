/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 局部更新Prop，未传字段保持原值。
 */
export type PropUpdate = {
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
     * 道具类型
     */
    prop_type?: (string | null);
    /**
     * 外形结构
     */
    shape?: (string | null);
    /**
     * 尺寸或相对尺度
     */
    size_description?: (string | null);
    /**
     * 材质
     */
    materials?: (string | null);
    /**
     * 颜色
     */
    colors?: (string | null);
};

