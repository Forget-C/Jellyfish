/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InputBinding } from './InputBinding';
import type { NamedImageObject } from './NamedImageObject';
import type { ReferenceImageBinding } from './ReferenceImageBinding';
/**
 * 单张主图的本地命名和明确名称绑定，标题与对象名相互独立。
 */
export type NamedImageReferenceCard = {
    id: string;
    type_version?: number;
    type: 'reference.character' | 'reference.place' | 'reference.prop' | 'reference.costume';
    title?: string;
    angle?: string;
    objects?: Array<NamedImageObject>;
    input_bindings?: Array<InputBinding>;
    image_binding?: (ReferenceImageBinding | null);
    positions?: Record<string, string>;
};
