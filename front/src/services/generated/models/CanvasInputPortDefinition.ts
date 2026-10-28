/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 候选入口及明确允许的值种类；连线仍不表示采用。
 */
export type CanvasInputPortDefinition = {
    id: string;
    label: string;
    relation: 'generation_input' | 'business_reference' | 'material_association';
    accepts: Array<'text' | 'image' | 'video' | 'audio' | 'object_reference' | 'anchor' | 'blocking' | 'beat' | 'event' | 'shot' | 'dialogue' | 'criterion'>;
};

