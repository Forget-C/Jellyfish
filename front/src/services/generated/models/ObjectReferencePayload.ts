/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 关系出口只携带对象身份，不传递描述、媒体或祖先内容。
 */
export type ObjectReferencePayload = {
    kind?: string;
    object_id: string;
    name: string;
    category: 'character' | 'prop' | 'costume' | 'place';
};
