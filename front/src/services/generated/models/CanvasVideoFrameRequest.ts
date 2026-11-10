/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasVideoFrameResult } from './CanvasVideoFrameResult';
/**
 * 准备选帧素材的可重试请求，不直接保存画布文档。
 */
export type CanvasVideoFrameRequest = {
    source_card_id: string;
    source_file_id: string;
    at_ms: number;
    result?: (CanvasVideoFrameResult | null);
    request_id: string;
};
