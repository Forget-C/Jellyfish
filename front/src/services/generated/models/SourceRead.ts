/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 原始身份保持不变；不可用来源不以当前数据冒充历史。
 */
export type SourceRead = {
    source: Source;
    status: 'ready' | 'unavailable';
    label: string;
    description: string;
    model_name?: (string | null);
    task_id?: (string | null);
    created_at?: (string | null);
    context_text?: (string | null);
    chapter_name?: (string | null);
    revision_id?: (string | null);
    revision_kind?: (string | null);
    file_id?: (string | null);
    file_name?: (string | null);
    media_kind?: (string | null);
};

