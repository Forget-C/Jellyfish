/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 冻结用户点击时的整场内容和请求身份；提交不等于应用建议。
 */
export type SceneDesignRequest = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
    model_id?: (string | null);
    instruction?: string;
    scope?: (Array<string> | null);
};
