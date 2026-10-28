/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 名称、身份与图内定位；绝不携带描述或穿着动作。
 */
export type NamedImageObject = {
    object_id: string;
    name?: string;
    category: 'character' | 'prop' | 'costume' | 'place';
    position?: string;
};
