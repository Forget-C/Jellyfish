/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionBaseline } from './DivisionBaseline';
import type { DivisionLineage } from './DivisionLineage';
import type { DivisionMember_Input } from './DivisionMember_Input';
/**
 * 最终整章方案；遗漏不等于退出，所有旧身份必须保留或明确退出。
 */
export type DivisionDraft = {
    source_version: string;
    source_basis_id?: (string | null);
    source_task_id?: (string | null);
    source_revision_id?: (string | null);
    restored_baseline?: Array<DivisionBaseline>;
    history_reconfirmed?: boolean;
    baseline: Array<DivisionBaseline>;
    members: Array<DivisionMember_Input>;
    exited_sequence_ids: Array<string>;
    lineage: Array<DivisionLineage>;
};
