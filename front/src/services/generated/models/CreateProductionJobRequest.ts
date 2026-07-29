/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EpisodePackage } from './EpisodePackage';
import type { EpisodePackageV11 } from './EpisodePackageV11';
/**
 * POST /production/jobs 请求体。
 */
export type CreateProductionJobRequest = {
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 待生产的 EpisodePackage（严格校验；接受 schema_version 1.0 或 1.1）
     */
    episode_package: (EpisodePackageV11 | EpisodePackage);
    /**
     * 供应商模式；本冲刺仅支持 mock
     */
    mode?: string;
};

