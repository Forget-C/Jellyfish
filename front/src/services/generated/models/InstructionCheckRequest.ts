/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 一次明确检查固定正文、依据与请求身份。
 */
export type InstructionCheckRequest = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
    model_id?: (string | null);
};
