/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasStoryboardObject } from './CanvasStoryboardObject';
import type { CanvasStoryboardOrigin } from './CanvasStoryboardOrigin';
import type { CanvasStoryboardShot } from './CanvasStoryboardShot';
/**
 * 由工作台建立的分镜采用范围和溯源索引。
 */
export type CanvasStoryboard = {
    task_id: string;
    mode: 'complete' | 'faithful';
    source_version: string;
    origins: Record<string, CanvasStoryboardOrigin>;
    objects: Array<CanvasStoryboardObject>;
    shots: Array<CanvasStoryboardShot>;
};
