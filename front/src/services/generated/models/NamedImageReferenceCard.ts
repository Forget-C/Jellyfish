/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
import type { ReferenceImageBinding } from './ReferenceImageBinding';
/**
 * 单张图片、单个映射名称；允许未完成草稿，名称有效后才发布输出。
 */
export type NamedImageReferenceCard = {
    id: string;
    type_version?: number;
    type: 'reference.character' | 'reference.place' | 'reference.prop' | 'reference.costume';
    name?: string;
    angle?: string;
    object_id?: (string | null);
    name_binding?: (OutputIdentity | null);
    image_binding?: (ReferenceImageBinding | null);
};
