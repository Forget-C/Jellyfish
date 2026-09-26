/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 直提出视频结果。
 */
export type VideoSubmitRead = {
    shot_id: string;
    provider?: string;
    status?: string;
    provider_task_id?: string;
    /**
     * 视频地址（临时地址，长期资产需落 OSS）
     */
    url?: string;
    /**
     * 本次调用是否已把视频落库（直接提交路径不落库）
     */
    file_persisted?: boolean;
    elapsed_ms?: number;
    error?: string;
    warnings?: Array<string>;
    guard_status?: string;
    note?: string;
};

