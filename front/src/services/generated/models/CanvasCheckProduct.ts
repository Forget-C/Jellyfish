/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 历史产物身份由具体运行、节点和产物位置固定。
 */
export type CanvasCheckProduct = {
    run_id: string;
    node_id: string;
    position: number;
    source: OutputIdentity;
    generation_status: 'succeeded' | 'failed' | 'cancelled';
    result_set_id?: (string | null);
    revision: number;
    text?: (string | null);
    modality?: 'text' | 'image' | 'video';
    file_id?: (string | null);
};
