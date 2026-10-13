/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneTakeRead } from './SceneTakeRead';
import type { SceneVideoPreparation_Output } from './SceneVideoPreparation_Output';
/**
 * 原版本单元的固定执行和实时任务状态，候选来自真实输出。
 */
export type SceneVideoRead = {
    execution_id: string;
    task_id: string;
    request_id: string;
    status: string;
    cancel_requested?: boolean;
    error: (string | null);
    retry_of_task_id?: (string | null);
    preparation: SceneVideoPreparation_Output;
    takes: Array<SceneTakeRead>;
};
