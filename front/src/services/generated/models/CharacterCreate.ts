/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建项目角色及明确图片参考，拒绝未声明的字段。
 */
export type CharacterCreate = {
    references?: Array<AssetPromptReference>;
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
    adopt_reference?: (AssetPromptReference | null);
    /**
     * 可选：章节 ID
     */
    chapter_id?: (string | null);
};
