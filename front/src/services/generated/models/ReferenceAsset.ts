/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一条参考资产：稳定 asset_id + 可选仓库相对路径（禁止供应商 URL）。
 */
export type ReferenceAsset = {
    /**
     * 角色键（角色参考用）
     */
    character_key?: (string | null);
    /**
     * 场景键（环境参考用）
     */
    scene_key?: (string | null);
    /**
     * 道具键（道具参考用）
     */
    prop_key?: (string | null);
    /**
     * 稳定不透明资产 ID
     */
    asset_id: string;
    /**
     * 不可变身份参考 vs 本集专用
     */
    kind?: 'identity' | 'episode';
    /**
     * 视角提示，如 front
     */
    view?: (string | null);
    /**
     * 仓库相对路径；**不得**为供应商 URL
     */
    path?: (string | null);
};

