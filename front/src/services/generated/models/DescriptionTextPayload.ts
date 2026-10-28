/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 描述出口保留本卡对象与来源信息；模型只展开正文。
 */
export type DescriptionTextPayload = {
    kind?: string;
    object_id: (string | null);
    name: string;
    category: 'character' | 'prop' | 'costume' | 'place';
    text: string;
    source_locator: string;
};
