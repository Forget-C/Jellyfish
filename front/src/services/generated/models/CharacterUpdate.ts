/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 更新角色组合，避免分类设定被错误吞掉。
 */
export type CharacterUpdate = {
    project_id?: (string | null);
    name?: (string | null);
    description?: (string | null);
    style?: (ProjectStyle | null);
    visual_style?: (ProjectVisualStyle | null);
    actor_id?: (string | null);
    costume_id?: (string | null);
};
