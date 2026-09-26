/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceImageRead } from './ReferenceImageRead';
import type { SubmissionTargetRead } from './SubmissionTargetRead';
/**
 * 出图提交计划预览。
 */
export type ImagePlanPreviewRead = {
    project_id: string;
    asset_type: string;
    stage: string;
    targets?: Array<SubmissionTargetRead>;
    references?: Array<ReferenceImageRead>;
    warnings?: Array<string>;
    summary?: Record<string, any>;
    /**
     * 当前守卫状态；preview 永远不触网
     */
    dry_run?: boolean;
    /**
     * 边界说明
     */
    note?: string;
};

