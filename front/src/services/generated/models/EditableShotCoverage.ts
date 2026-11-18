/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 人工镜头允许尚未分配节拍；已填写关联仍由工作单验证身份。
 */
export type EditableShotCoverage = {
    id: string;
    beat_ids: Array<string>;
    event_ids: Array<string>;
    blocking_state_ids: Array<string>;
    /**
     * 镜头参与人物／物件 ID；null 为范围待核对，空列表为明确无对象，不代表参考输入或实际媒体覆盖。
     */
    participant_ids: (Array<string> | null);
    criterion_ids: Array<string>;
    narrative_function: Note_Output;
    visible_result: Note_Output;
    estimated_duration_ms: (number | null);
};
