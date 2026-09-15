/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 仅公开实际冻结的模型身份和视频参数，不暴露供应商凭据。
 */
export type LedgerExecution = {
    task_id: string;
    status: string;
    model_name: (string | null);
    provider_key: (string | null);
    ratio: (string | null);
    seconds: (number | null);
    seed: (number | null);
    snapshot_available: boolean;
};
