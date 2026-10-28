/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 前后态与证据固定到直接媒体产物及对应字段。
 */
export type ConstraintMediaExample = {
    id: string;
    source: OutputIdentity;
    file_id: string;
    purpose?: 'positive' | 'negative' | 'before' | 'after' | 'evidence';
    field_id?: ('spatial_basis' | 'shootable_area' | 'axis' | 'scale' | 'before' | 'change' | 'after' | 'following_constraints' | 'fact' | 'source_basis' | null);
    description?: string;
    start_ms?: (number | null);
    end_ms?: (number | null);
};
