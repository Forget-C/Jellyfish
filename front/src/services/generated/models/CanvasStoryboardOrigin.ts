/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasSourceIndex } from './CanvasSourceIndex';
/**
 * 保留创建来源，人工修改不会把提取卡变为人工新增卡。
 */
export type CanvasStoryboardOrigin = {
    semantic_key: string;
    sources?: Array<CanvasSourceIndex>;
    manually_edited?: boolean;
};
