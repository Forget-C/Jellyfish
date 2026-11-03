/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignOccurrence } from './DesignOccurrence';
/**
 * 原字段或独立条目的内容用途；背景不自动变成执行要求。
 */
export type RelationshipUse = {
    owner: string;
    field: string;
    purpose: 'background' | 'design' | 'constraint';
    scope?: ('scene' | 'scene_rule' | 'shots' | 'occurrences' | null);
    shot_ids?: Array<string>;
    occurrences?: Array<DesignOccurrence>;
    phase?: ('video' | 'sound' | 'postproduction' | null);
    condition?: (string | null);
    reason: string;
    has_content?: boolean;
};
