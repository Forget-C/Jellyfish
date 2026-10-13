/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneDeliveryRead } from './SceneDeliveryRead';
/**
 * 当前章节顺序与明确交付来源分别表达。
 */
export type ChapterSceneDelivery = {
    sequence_id: string;
    title: string;
    position: number;
    delivery: (SceneDeliveryRead | null);
};
