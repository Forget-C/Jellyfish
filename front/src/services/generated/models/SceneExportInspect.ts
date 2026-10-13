/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneTimeline_Input } from './SceneTimeline_Input';
/**
 * 只读检查当前剪辑，可包含尚未保存的编辑。
 */
export type SceneExportInspect = {
    timeline: SceneTimeline_Input;
    output_aspect_ratio: '16:9' | '9:16' | '1:1';
    size?: 1080 | 720;
};
