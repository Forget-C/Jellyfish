/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
/**
 * 表演明确采用的对白依据；不携带参考素材或祖先内容。
 */
export type DialogueBasis = {
    dialogue_id: string;
    version: number;
    content: DesignField;
    speaker?: (ObjectReferencePayload | null);
};
