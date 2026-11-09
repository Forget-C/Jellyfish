/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardBasisObject } from './StoryboardBasisObject';
/**
 * 提交时以同一来源、准备修订及参考身份重新核对。
 */
export type StoryboardBasis = {
    token: string;
    source_text: string;
    source_changed: boolean;
    preparation_revision: number;
    preparation_stale: boolean;
    object_task_active: boolean;
    objects: Array<StoryboardBasisObject>;
};
