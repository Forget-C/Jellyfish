/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionMember_Output } from './DivisionMember_Output';
import type { SequenceRead } from './SequenceRead';
/**
 * 逐场展示真实差异与保留的成果，不把范围变化表达为自动重制。
 */
export type DivisionImpact = {
    key: string;
    before: (SequenceRead | null);
    after: (DivisionMember_Output | null);
    changes: Array<'added' | 'title' | 'position' | 'range' | 'source' | 'exited' | 'restored' | 'shooting_preparation'>;
    design_count: number;
    plan_count: number;
    take_count: number;
    cut_count: number;
    active_cut_revision_id: (string | null);
};
