/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 顶部统计用的汇总（与逐项标志同一份数据算出来）。
 */
export type ProjectAssetReadinessSummary = {
    /**
     * 参与准备的资产总数
     */
    total?: number;
    /**
     * 按类型分组的数量
     */
    asset_counts?: Record<string, number>;
    /**
     * 已保存图片提示词的资产数
     */
    with_image_prompt?: number;
    /**
     * 已有图片的资产数
     */
    with_image?: number;
    /**
     * 已定版的资产数
     */
    with_primary?: number;
    /**
     * 提示词 / 图片 / 定版齐全且无待确认候选的资产数
     */
    done?: number;
    /**
     * 是否所有资产都已定版
     */
    all_done?: boolean;
};

