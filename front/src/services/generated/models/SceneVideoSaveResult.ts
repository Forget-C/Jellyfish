/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionRead } from './SceneVersionRead';
/**
 * 保存成功后即使执行受阻也返回保存结果，供界面保留正确基线。
 */
export type SceneVideoSaveResult = {
    version: SceneVersionRead;
    task_id: (string | null);
    error: (string | null);
};
