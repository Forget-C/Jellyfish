/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneExportProfile } from './SceneExportProfile';
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
/**
 * 后台只消费该快照，不能回读当前可编辑版本。
 */
export type SceneExportSnapshot = {
    version_id: string;
    revision: number;
    content: SceneVersionContent_Output;
    profile: SceneExportProfile;
};
