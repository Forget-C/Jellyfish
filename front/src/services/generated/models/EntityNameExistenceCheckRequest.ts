/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 批量检测项目内/全局资产名称是否存在（模糊匹配）。
 */
export type EntityNameExistenceCheckRequest = {
    /**
     * 项目 ID（必填）
     */
    project_id: string;
    /**
     * 角色名称列表
     */
    character_names?: Array<string>;
    /**
     * 道具名称列表
     */
    prop_names?: Array<string>;
    /**
     * 场景名称列表
     */
    scene_names?: Array<string>;
    /**
     * 服装名称列表
     */
    costume_names?: Array<string>;
};
