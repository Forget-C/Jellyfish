/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneMediaCutItem } from './SceneMediaCutItem';
import type { ScenePlannedCutItem } from './ScenePlannedCutItem';
/**
 * 复用单轨身份与重叠校验，允许空轨及有意保留的位置空白。
 */
export type SceneTimeline = {
    items: Array<(ScenePlannedCutItem | SceneMediaCutItem)>;
};
