/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectAssetReadinessItem } from './ProjectAssetReadinessItem';
import type { ProjectAssetReadinessSummary } from './ProjectAssetReadinessSummary';
/**
 * 项目资产准备清单。
 */
export type ProjectAssetReadinessRead = {
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 逐资产准备状态
     */
    items?: Array<ProjectAssetReadinessItem>;
    /**
     * 汇总
     */
    summary?: ProjectAssetReadinessSummary;
};

