/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionSave } from './SceneVersionSave';
/**
 * 点击时固定待保存内容与视频请求；后续编辑不能替换这份输入。
 */
export type SceneVideoSaveRequest = {
    request_id: string;
    save: SceneVersionSave;
};
