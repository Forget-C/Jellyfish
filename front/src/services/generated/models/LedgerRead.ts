/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ContinuityRead } from './ContinuityRead';
import type { FeedbackRead } from './FeedbackRead';
import type { LedgerAction } from './LedgerAction';
import type { LedgerExecution } from './LedgerExecution';
import type { WorkspaceRead } from './WorkspaceRead';
/**
 * 设计、提示词、输入、产出、观察及返工关系的一次只读查询。
 */
export type LedgerRead = {
    workspace: WorkspaceRead;
    continuity: ContinuityRead;
    feedback: FeedbackRead;
    actions: Array<LedgerAction>;
    executions: Array<LedgerExecution>;
};
