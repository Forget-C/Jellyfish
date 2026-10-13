/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVideoPreparation_Input } from './SceneVideoPreparation_Input';
/**
 * 原请求身份不变；可绑定明确预检输入，提交时重新核对相关内容。
 */
export type SceneVideoSubmitRequest = {
    expected_revision: number;
    request_id: string;
    expected_preparation?: (SceneVideoPreparation_Input | null);
};
