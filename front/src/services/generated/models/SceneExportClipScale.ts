/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 实测显示尺寸与填满裁切后有效尺寸，不使用生成请求的名义分辨率。
 */
export type SceneExportClipScale = {
    clip_id: string;
    source_width: number;
    source_height: number;
    effective_width: number;
    effective_height: number;
    scale: number;
    needs_upscale: boolean;
};
