/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasContentOrigin } from './CanvasContentOrigin';
/**
 * 音频内容卡只导入和播放，不提供音频生成。
 */
export type AudioContentCard = {
    id: string;
    type_version?: number;
    file_id?: (string | null);
    uploading?: boolean;
    origin?: (CanvasContentOrigin | null);
    type?: string;
};
