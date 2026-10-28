/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ObjectReferencePayload } from './ObjectReferencePayload';
/**
 * 对白关系出口只声明身份、版本与说话对象。
 */
export type DialogueReferencePayload = {
    dialogue_id: string;
    version: number;
    speaker?: (ObjectReferencePayload | null);
    kind?: 'dialogue_reference';
};

