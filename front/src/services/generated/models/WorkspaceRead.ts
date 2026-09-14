/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RevisionSnapshot_ProductionPlan_ } from './RevisionSnapshot_ProductionPlan_';
import type { RevisionSnapshot_Prompt_ } from './RevisionSnapshot_Prompt_';
import type { RevisionSnapshot_ReviewPacket_ } from './RevisionSnapshot_ReviewPacket_';
import type { RevisionSnapshot_SceneDesign_ } from './RevisionSnapshot_SceneDesign_';
import type { RevisionSnapshot_SequenceCut_ } from './RevisionSnapshot_SequenceCut_';
import type { SequenceRead } from './SequenceRead';
import type { TakeSnapshot } from './TakeSnapshot';
/**
 * 一份场次共享上下文，三视图不维护不同版本的真值。
 */
export type WorkspaceRead = {
    sequence: SequenceRead;
    designs: Array<RevisionSnapshot_SceneDesign_>;
    plans: Array<RevisionSnapshot_ProductionPlan_>;
    prompts: Array<RevisionSnapshot_Prompt_>;
    reviews: Array<RevisionSnapshot_ReviewPacket_>;
    cuts: Array<RevisionSnapshot_SequenceCut_>;
    takes: Array<TakeSnapshot>;
    task_ids: Array<string>;
};

