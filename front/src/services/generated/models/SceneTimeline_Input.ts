/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneMediaCutItem_Input } from './SceneMediaCutItem_Input';
import type { ScenePlannedCutItem } from './ScenePlannedCutItem';
/**
 * 复用单轨身份与重叠校验，允许空轨及有意保留的位置空白。
 */
export type SceneTimeline_Input = {
    items?: Array<(ScenePlannedCutItem | SceneMediaCutItem_Input)>;
};
