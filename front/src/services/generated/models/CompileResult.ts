/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewPacketRevision } from './ReviewPacketRevision';
import type { RevisionSnapshot_ProductionPlan_ } from './RevisionSnapshot_ProductionPlan_';
import type { RevisionSnapshot_Prompt_ } from './RevisionSnapshot_Prompt_';
import type { RevisionSnapshot_SceneDesign_ } from './RevisionSnapshot_SceneDesign_';
import type { RevisionSnapshot_SequenceCut_ } from './RevisionSnapshot_SequenceCut_';
import type { SequenceRead } from './SequenceRead';
import type { TakeSnapshot } from './TakeSnapshot';
/**
 * 编译响应明确返回本次操作产出的指令，不从工作区排序推测。
 */
export type CompileResult = {
    sequence: SequenceRead;
    designs: Array<RevisionSnapshot_SceneDesign_>;
    plans: Array<RevisionSnapshot_ProductionPlan_>;
    prompts: Array<RevisionSnapshot_Prompt_>;
    reviews: Array<ReviewPacketRevision>;
    cuts: Array<RevisionSnapshot_SequenceCut_>;
    takes: Array<TakeSnapshot>;
    task_ids: Array<string>;
    compiled_prompt_revision_id: string;
};
