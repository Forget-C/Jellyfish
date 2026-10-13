/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneExportClipScale } from './SceneExportClipScale';
import type { SceneExportProfile } from './SceneExportProfile';
/**
 * 读取时的实际媒体检查，不代表保存或提交任务。
 */
export type SceneExportInspection = {
    profile: SceneExportProfile;
    clips: Array<SceneExportClipScale>;
};
