/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasContentOrigin } from './CanvasContentOrigin';
/**
 * 视频内容保留完整文件及自带音轨。
 */
export type VideoContentCard = {
    id: string;
    type_version?: number;
    file_id?: (string | null);
    uploading?: boolean;
    origin?: (CanvasContentOrigin | null);
    type?: string;
};
