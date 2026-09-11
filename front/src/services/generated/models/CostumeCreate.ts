/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建Costume，只接收该类别的可编辑设定。
 */
export type CostumeCreate = {
    id: string;
    name: string;
    tags?: Array<string>;
    prompt_template_id?: (string | null);
    view_count?: number;
    style?: ProjectStyle;
    visual_style?: ProjectVisualStyle;
    /**
     * 可选：创建成功后写入 project_*_link（与资产创建同一事务）
     */
    project_id?: (string | null);
    /**
     * 可选：章节 ID
     */
    chapter_id?: (string | null);
    /**
     * 可选：分镜 ID
     */
    shot_id?: (string | null);
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

