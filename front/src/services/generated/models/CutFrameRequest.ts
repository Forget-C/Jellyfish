/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 从用户看到的已确认剪辑项提取入幅或落幅。
 */
export type CutFrameRequest = {
    cut_revision_id: string;
    item_id: string;
    edge: 'start' | 'end';
};
