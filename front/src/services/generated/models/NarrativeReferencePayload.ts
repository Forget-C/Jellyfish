/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 稳定节拍、事件或镜头身份；不携带关联正文或媒体。
 */
export type NarrativeReferencePayload = {
    kind?: 'narrative_reference';
    category: 'beat' | 'event' | 'shot';
    reference_id: string;
    name: string;
};
