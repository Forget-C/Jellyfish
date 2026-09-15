/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建角色组合，拒绝未声明的字段。
 */
export type CharacterCreate = {
    /**
     * 角色 ID
     */
    id: string;
    /**
     * 所属项目 ID
     */
    project_id: string;
    /**
     * 角色名称
     */
    name: string;
    /**
     * 角色描述
     */
    description?: string;
    /**
     * 题材/风格
     */
    style?: ProjectStyle;
    /**
     * 画面表现形式（现实/动漫等）
     */
    visual_style?: ProjectVisualStyle;
    /**
     * 演员 ID（可空；用于仅导入角色文案但不关联演员时）
     */
    actor_id?: (string | null);
    /**
     * 服装 ID（可空）
     */
    costume_id?: (string | null);
    /**
     * 可选：章节 ID
     */
    chapter_id?: (string | null);
};
