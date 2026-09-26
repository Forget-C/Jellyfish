/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 项目内一项资产的准备状态（四类资产同一口径，见 `project_asset_readiness`）。
 */
export type ProjectAssetReadinessItem = {
    /**
     * 资产类型
     */
    asset_type: 'character' | 'scene' | 'prop' | 'costume';
    /**
     * 资产 ID
     */
    asset_id: string;
    /**
     * 资产名称
     */
    name?: string;
    /**
     * 本项目内是否还有同类型同名的未确认提取候选
     */
    has_pending_candidate?: boolean;
    /**
     * 是否已保存图片提示词（image_prompts 有非空槽位）
     */
    has_image_prompt?: boolean;
    /**
     * 是否已有图片（*_images 里有 file_id 非空的行）
     */
    has_image?: boolean;
    /**
     * 是否已设为定版（上述行里有 is_primary）
     */
    has_primary?: boolean;
    /**
     * 当前首选图地址（空串 = 还没有图）
     */
    thumbnail?: string;
    /**
     * 当前首选图的行 ID（「设为定版」的默认目标）
     */
    image_id?: (number | null);
};

