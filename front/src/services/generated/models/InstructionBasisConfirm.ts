/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 显式确认已按本次依据核对正文；原请求可幂等核实。
 */
export type InstructionBasisConfirm = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
};
