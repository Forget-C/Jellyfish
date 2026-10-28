/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 空间对象只提供稳定身份和名称，不带设计正文或祖先。
 */
export type SpatialReferencePayload = {
    kind?: 'spatial_reference';
    category: 'anchor' | 'blocking';
    reference_id: string;
    name: string;
};

