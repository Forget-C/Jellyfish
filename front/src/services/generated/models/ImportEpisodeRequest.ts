/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EpisodePackage } from './EpisodePackage';
import type { EpisodePackageV11 } from './EpisodePackageV11';
/**
 * POST /api/v1/crypto-animal-studio/import 的请求体。
 */
export type ImportEpisodeRequest = {
    /**
     * 目标 Jellyfish 项目 ID（系列/季）
     */
    project_id: string;
    /**
     * 待导入的 EpisodePackage（严格校验；接受 schema_version 1.0 或 1.1）
     */
    episode_package: (EpisodePackageV11 | EpisodePackage);
    /**
     * 为真时只校验/映射/复用查找/告警，不写库
     */
    dry_run?: boolean;
    /**
     * 幂等键
     */
    idempotency_key: string;
};

