/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 不预先保存来源版本；固定原修订、完整内容和一次创建授权。
 */
export type SceneVersionCopy = {
    request_id: string;
    expected_revision: number;
    title: string;
    content: SceneVersionContent_Input;
};
