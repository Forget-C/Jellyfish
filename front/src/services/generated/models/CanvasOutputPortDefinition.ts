/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 明确出口及采用单位，动态范围继续由实例输出声明。
 */
export type CanvasOutputPortDefinition = {
    id: string;
    label: string;
    value_kind: 'text' | 'image' | 'video' | 'audio' | 'object_reference' | 'anchor' | 'blocking' | 'beat' | 'event' | 'shot' | 'dialogue' | 'criterion' | 'check_basis';
    adoption: 'whole_card' | 'declared_scope' | 'object' | 'item' | 'observation';
};
