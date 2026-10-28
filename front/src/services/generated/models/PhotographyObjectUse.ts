/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ObjectReferencePayload } from './ObjectReferencePayload';
/**
 * 对象关系保留明确用途；焦点与关注对象只跟随相应采用区域。
 */
export type PhotographyObjectUse = {
    input_port: 'effect_object' | 'attention_object' | 'focus_object';
    object: ObjectReferencePayload;
};
