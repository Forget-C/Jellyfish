/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignOccurrence } from './DesignOccurrence';
import type { DesignSubject } from './DesignSubject';
/**
 * 一个来源字段只声明一种范围；约束另记制作阶段和可选条件。
 */
export type DesignApplicability = {
    subject: DesignSubject;
    purpose: 'background' | 'design' | 'constraint';
    scope: 'scene' | 'scene_rule' | 'shots' | 'occurrences';
    shot_ids?: Array<string>;
    occurrences?: Array<DesignOccurrence>;
    phase?: ('video' | 'sound' | 'postproduction' | null);
    condition?: (string | null);
};
