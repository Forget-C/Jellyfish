/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 版本明确采用的原文及原始位置，章节更新不改写该依据。
 */
export type SceneVersionSource_Input = {
    source: Source;
    start?: (number | null);
    end?: (number | null);
    text: string;
};
