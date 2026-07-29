/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImportCounts } from './ImportCounts';
import type { SubtitleArtifact } from './SubtitleArtifact';
/**
 * 一次导入（或 dry-run / 重放）的结果摘要。
 */
export type ImportResult = {
    /**
     * imported | dry_run | replayed
     */
    status: string;
    /**
     * 是否为 dry-run（未写库）
     */
    dry_run: boolean;
    /**
     * 是否命中幂等重放（返回既有结果）
     */
    idempotent_replay: boolean;
    project_id: string;
    episode_id: string;
    idempotency_key: string;
    /**
     * EpisodePackage 规范化 SHA-256
     */
    payload_hash: string;
    /**
     * 产生/既有的 Chapter ID；dry-run 为 null
     */
    chapter_id?: (string | null);
    /**
     * Chapter 在项目内的序号；dry-run 为拟用序号
     */
    chapter_index?: (number | null);
    /**
     * 本次新建计数
     */
    created?: ImportCounts;
    /**
     * 本次复用计数
     */
    reused?: ImportCounts;
    /**
     * 非阻断告警（不丢弃数据）
     */
    warnings?: Array<string>;
    /**
     * 本次导入生成/复用的字幕产物（WebVTT）；v1 文档为空列表
     */
    subtitle_artifacts?: Array<SubtitleArtifact>;
};

