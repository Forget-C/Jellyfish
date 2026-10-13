/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCopyBlocker } from './SceneCopyBlocker';
/**
 * 只读预检不授权稍后的创建；创建事务必须重新核验。
 */
export type SceneCopyReadiness = {
    ready: boolean;
    blockers: Array<SceneCopyBlocker>;
};
