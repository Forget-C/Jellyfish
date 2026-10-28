/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 示例只关联直接媒体，正反用途及视频／音频有效区间不成为生成输入。
 */
export type DesignMediaExample = {
    id: string;
    source: OutputIdentity;
    file_id: string;
    purpose?: 'positive' | 'negative';
    field_id?: (string | null);
    description?: string;
    start_ms?: (number | null);
    end_ms?: (number | null);
};
