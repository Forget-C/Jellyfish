/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 接收端点及允许的值种类；连线生效语义由公开连接策略声明。
 */
export type CanvasInputPortDefinition = {
    id: string;
    label: string;
    relation: 'generation_input' | 'business_reference' | 'material_association';
    accepts: Array<'text' | 'image' | 'video' | 'audio' | 'object_reference' | 'anchor' | 'blocking' | 'beat' | 'event' | 'shot' | 'dialogue' | 'criterion'>;
    max_sources?: (number | null);
};
