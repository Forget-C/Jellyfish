/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionResult } from './DivisionResult';
import type { EditableSceneDesign } from './EditableSceneDesign';
import type { InstructionCheckResult } from './InstructionCheckResult';
import type { ReviewPacket } from './ReviewPacket';
import type { ReviewRevisionApplication } from './ReviewRevisionApplication';
import type { ReviewRevisionCandidate } from './ReviewRevisionCandidate';
import type { ReviewRevisionRequest } from './ReviewRevisionRequest';
import type { SceneDesign_Output } from './SceneDesign_Output';
import type { SceneInstructionResult } from './SceneInstructionResult';
/**
 * 业务面板查询建议；通用任务中心仍只展示状态。
 */
export type DirectingTaskRead = {
    task_id: string;
    kind: string;
    status: string;
    error: (string | null);
    source_version: (string | null);
    division_baseline?: (Record<string, any> | null);
    division?: (DivisionResult | null);
    design?: (SceneDesign_Output | null);
    scene_design?: (EditableSceneDesign | null);
    scene_instruction?: (SceneInstructionResult | null);
    instruction_check?: (InstructionCheckResult | null);
    review?: (ReviewPacket | null);
    revision?: (ReviewRevisionCandidate | null);
    revision_request?: (ReviewRevisionRequest | null);
    revision_application?: (ReviewRevisionApplication | null);
    image_file_ids?: Array<string>;
};

