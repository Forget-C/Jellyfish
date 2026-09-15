/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 公开批准动作的显示文案、版本、任务和人，不暴露供应商凭据。
 */
export type LedgerAction = {
    revision_id: string;
    review_revision_id: (string | null);
    action: string;
    actor_id: string;
    displayed_label: string;
    unit_id: string;
    task_id: (string | null);
    created_at: string;
};
