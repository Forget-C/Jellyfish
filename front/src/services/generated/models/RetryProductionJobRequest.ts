/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EpisodePackage } from './EpisodePackage';
import type { EpisodePackageV11 } from './EpisodePackageV11';
/**
 * POST /production/jobs/{job_id}/retry 请求体。
 */
export type RetryProductionJobRequest = {
    /**
     * 与原任务一致的 EpisodePackage（用于重跑；接受 schema_version 1.0 或 1.1）
     */
    episode_package: (EpisodePackageV11 | EpisodePackage);
    /**
     * 供应商模式；本冲刺仅支持 mock
     */
    mode?: string;
};

