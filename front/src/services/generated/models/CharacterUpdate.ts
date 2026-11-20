/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 更新角色自身设定和明确参考，拒绝未知分类字段。
 */
export type CharacterUpdate = {
    references?: Array<AssetPromptReference>;
    details_editable?: (boolean | null);
    name?: (string | null);
    description?: (string | null);
    style?: (ProjectStyle | null);
    visual_style?: (ProjectVisualStyle | null);
};

