/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单个名称的存在性结果。
 */
export type EntityNameExistenceItem = {
    /**
     * 输入名称（原样回传）
     */
    name: string;
    /**
     * 数据库中是否存在（模糊命中）
     */
    exists: boolean;
    /**
     * 是否已关联到该项目（角色等同于 exists）
     */
    linked_to_project: boolean;
    /**
     * 命中的资产 ID（如 prop_id/scene_id/costume_id/character_id）
     */
    asset_id?: (string | null);
    /**
     * 若已关联到项目，对应 Project*Link 的 id；否则为空
     */
    link_id?: (number | null);
};
