/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ExperimentMessageRead } from './ExperimentMessageRead';
/**
 * 创建生成任务后返回任务标识和可直接接管乐观 UI 的权威消息。
 */
export type ExperimentTaskCreated = {
    task_id: string;
    /**
     * 本次提交创建的用户消息与任务消息，按 sequence 正序返回
     */
    messages: Array<ExperimentMessageRead>;
};

