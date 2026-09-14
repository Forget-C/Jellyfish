/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 记录已核验范围；unknown 不能自动提升为支持。
 */
export type ModelCapability_Input = {
    multi_shot?: 'unknown' | 'supported' | 'unsupported';
    reference_kinds?: Array<'image' | 'video' | 'audio'>;
    evidence?: (Source | null);
};

