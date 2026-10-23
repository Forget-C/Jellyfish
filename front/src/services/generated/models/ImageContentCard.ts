/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasContentOrigin } from './CanvasContentOrigin';
/**
 * 图片内容卡只有一个图片输出位置。
 */
export type ImageContentCard = {
    id: string;
    type_version?: number;
    file_id?: (string | null);
    uploading?: boolean;
    origin?: (CanvasContentOrigin | null);
    type?: string;
};
