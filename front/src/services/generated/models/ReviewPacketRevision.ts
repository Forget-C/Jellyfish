/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewPacket } from './ReviewPacket';
/**
 * 模型检查应用一次后固定原任务身份；人工派生版本不占用原任务身份。
 */
export type ReviewPacketRevision = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    parent_id: (string | null);
    version: number;
    confirmed_by: (string | null);
    confirmed_at: (string | null);
    source_current?: boolean;
    content: ReviewPacket;
    source_task_id?: (string | null);
};

