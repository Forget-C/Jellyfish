/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 同一个故事对象在当前画布的共享描述与参考卡。
 */
export type CanvasStoryboardObject = {
    object_id: string;
    description_card_id: string;
    reference_card_id: string;
    origin?: 'prepared' | 'missed';
};
