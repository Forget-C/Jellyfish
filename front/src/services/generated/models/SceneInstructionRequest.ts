/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneInstructionScope } from './SceneInstructionScope';
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 同一次点击保留请求身份和当前输入，提交不保存或执行视频。
 */
export type SceneInstructionRequest = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
    model_id?: (string | null);
    requirements?: string;
    scope?: (SceneInstructionScope | null);
};
