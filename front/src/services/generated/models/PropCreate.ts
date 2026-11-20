/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建Prop，只接收该类别的可编辑设定。
 */
export type PropCreate = {
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
