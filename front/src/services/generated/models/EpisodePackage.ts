/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetLibrary } from './AssetLibrary';
import type { CharacterSpec } from './CharacterSpec';
import type { CreativeDirection } from './CreativeDirection';
import type { EpisodeMetadata } from './EpisodeMetadata';
import type { NewsSource } from './NewsSource';
import type { Shot } from './Shot';
/**
 * EpisodePackage v1 根对象：一集的完整交付包。
 *
 * 一个 EpisodePackage 对应 Jellyfish 的一个 Chapter；其 ``shots`` 直接建立
 * Jellyfish 的 Shot（不回送 ScriptDivider）。跨引用完整性由 ``_validate_cross_references``
 * 统一校验。
 */
export type EpisodePackage = {
    /**
     * 契约版本；v1 必须等于 "1.0"
     */
    schema_version: string;
    /**
     * 一集的唯一 ID（非空）
     */
    episode_id: string;
    /**
     * 剧集标题（非空）
     */
    title: string;
    /**
     * 一句话梗概
     */
    logline?: string;
    /**
     * 语言（如 en、zh；非空）
     */
    language: string;
    /**
     * 素材来源
     */
    source: NewsSource;
    /**
     * 创意方向
     */
    creative_direction: CreativeDirection;
    /**
     * 出场角色（键须唯一）
     */
    characters: Array<CharacterSpec>;
    /**
     * 素材库
     */
    assets: AssetLibrary;
    /**
     * 镜头列表（至少一个）
     */
    shots: Array<Shot>;
    /**
     * 生成元信息
     */
    metadata: EpisodeMetadata;
};

