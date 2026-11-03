/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 写入一条仅用于用户历史展示的消息。
 */
export type ExperimentMessageCreate = {
    role: 'user' | 'assistant' | 'task';
    content?: string;
    status?: (string | null);
    payload?: Record<string, any>;
    task_id?: (string | null);
};

