/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 计划镜头只表达叙事覆盖；不绑定生成任务或实际时间码。
 */
export type ShotCoverage_Output = {
    id: string;
    beat_ids: Array<string>;
    event_ids: Array<string>;
    blocking_state_ids: Array<string>;
    criterion_ids: Array<string>;
    narrative_function: Note_Output;
    visible_result: Note_Output;
    estimated_duration_ms?: (number | null);
};

