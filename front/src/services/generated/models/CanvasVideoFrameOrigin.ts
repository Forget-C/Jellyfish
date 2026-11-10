/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasVideoFrameResult } from './CanvasVideoFrameResult';
/**
 * 图片来源与提取时的视频结果集合身份；原视频不构成图片的运行依赖。
 */
export type CanvasVideoFrameOrigin = {
    source_card_id: string;
    source_file_id: string;
    at_ms: number;
    result?: (CanvasVideoFrameResult | null);
    result_set_id?: (string | null);
};
