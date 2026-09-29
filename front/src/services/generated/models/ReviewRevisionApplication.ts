/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 已持久化步骤身份；失败保留产物，下次同请求继续。
 */
export type ReviewRevisionApplication = {
    task_id: string;
    request_id: string;
    stage: 'saved' | 'compiled' | 'reviewing' | 'blocked';
    design_revision_id?: (string | null);
    plan_revision_id?: (string | null);
    prompt_revision_id?: (string | null);
    review_task_id?: (string | null);
    error?: (string | null);
};
