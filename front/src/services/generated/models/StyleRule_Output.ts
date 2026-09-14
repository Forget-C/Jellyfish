/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
import type { Source } from './Source';
/**
 * 有来源、例外和范围的可观察规则；空范围表示项目通用。
 */
export type StyleRule_Output = {
    id: string;
    role: 'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt';
    requirement: string;
    exceptions?: Note_Output;
    sequence_ids?: Array<string>;
    model_names?: Array<string>;
    status?: 'candidate' | 'confirmed' | 'deprecated';
    sources: Array<Source>;
};
