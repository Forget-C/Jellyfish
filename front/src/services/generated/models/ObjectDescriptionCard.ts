/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 画布内独立描述对象；未完成名称或身份可以保存但不发布引用。
 */
export type ObjectDescriptionCard = {
    id: string;
    type_version?: number;
    type?: string;
    object_id?: (string | null);
    name?: string;
    category?: 'character' | 'prop' | 'costume';
    text?: string;
    source_locator?: string;
};
