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
    /**
     * 镜头参与人物／物件 ID；null 为范围待核对，空列表为明确无对象，不代表参考输入或实际媒体覆盖。
     */
    participant_ids?: (Array<string> | null);
    criterion_ids: Array<string>;
    narrative_function: Note_Output;
    visible_result: Note_Output;
    estimated_duration_ms?: (number | null);
};
