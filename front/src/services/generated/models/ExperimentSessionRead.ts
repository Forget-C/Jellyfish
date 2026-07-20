/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 会话列表和详情的展示结构。
 */
export type ExperimentSessionRead = {
    id: string;
    lab_type: 'text' | 'image' | 'video';
    title: string;
    created_at: string;
    updated_at: string;
    last_message_preview?: (string | null);
    has_running_task?: boolean;
};

