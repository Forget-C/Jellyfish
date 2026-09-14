/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionResult } from './DivisionResult';
import type { ReviewPacket } from './ReviewPacket';
import type { SceneDesign_Output } from './SceneDesign_Output';
/**
 * 业务面板查询建议；通用任务中心仍只展示状态。
 */
export type DirectingTaskRead = {
    task_id: string;
    kind: string;
    status: string;
    error: (string | null);
    source_version: (string | null);
    division?: (DivisionResult | null);
    design?: (SceneDesign_Output | null);
    review?: (ReviewPacket | null);
};

