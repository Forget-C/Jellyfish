/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterSceneDelivery } from './ChapterSceneDelivery';
/**
 * 不把未交付场次或未验收画面提升为已使用／已通过。
 */
export type ChapterDeliveriesRead = {
    chapter_id: string;
    title: string;
    sequences: Array<ChapterSceneDelivery>;
};
