/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 局部更新Costume，未传字段保持原值。
 */
export type CostumeUpdate = {
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
     * 服装类型
     */
    costume_type?: (string | null);
    /**
     * 款式层次
     */
    structure?: (string | null);
    /**
     * 材质
     */
    materials?: (string | null);
    /**
     * 颜色
     */
    colors?: (string | null);
    /**
     * 纹样与附属配饰
     */
    patterns_accessories?: (string | null);
};

