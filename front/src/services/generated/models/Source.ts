/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
/**
 * 来源可指向人工记录、原文版本或带时间码的文件。
 */
export type Source = {
    kind: 'human' | 'chapter' | 'model' | 'file' | 'revision';
    reference: string;
    version: string;
    file_id?: (string | null);
    media_range?: (MediaRange | null);
};
