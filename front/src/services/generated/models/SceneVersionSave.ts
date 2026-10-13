/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 保存沿用方案身份，revision 仅用于并发保护，不是可选历史版本。
 */
export type SceneVersionSave = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
};
