/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CutWrite } from './CutWrite';
import type { DesignWrite } from './DesignWrite';
import type { PlanWrite } from './PlanWrite';
/**
 * 创建、派生或 CAS 修改业务草稿，提示词与审稿由专用流程产生。
 */
export type RevisionWrite = {
    document: (DesignWrite | PlanWrite | CutWrite);
    sequence_version?: (number | null);
    revision_id?: (string | null);
    expected_version?: (number | null);
    parent_id?: (string | null);
};
