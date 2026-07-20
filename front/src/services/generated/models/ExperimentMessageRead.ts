/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 持久化消息的展示结构。
 */
export type ExperimentMessageRead = {
    role: 'user' | 'assistant' | 'task';
    content?: string;
    status?: (string | null);
    payload?: Record<string, any>;
    task_id?: (string | null);
    id: string;
    session_id: string;
    created_at: string;
    updated_at: string;
};

