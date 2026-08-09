/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetLibrary } from './AssetLibrary';
import type { CharacterSpec } from './CharacterSpec';
import type { CreativeDirection } from './CreativeDirection';
import type { EpisodeMetadata } from './EpisodeMetadata';
import type { FactCard } from './FactCard';
import type { Localization } from './Localization';
import type { MarketData } from './MarketData';
import type { NewsSource } from './NewsSource';
import type { OutputSpec } from './OutputSpec';
import type { PostProduction } from './PostProduction';
import type { References } from './References';
import type { ShotV11 } from './ShotV11';
/**
 * EpisodePackage v1.1 根对象：v1 全部字段 + 六个可选顶层对象；shots 使用 ShotV11。
 */
export type EpisodePackageV11 = {
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
    shots: Array<ShotV11>;
    /**
     * 生成元信息
     */
    metadata: EpisodeMetadata;
    /**
     * 输出规格（缺省时用文档化默认值）
     */
    output?: (OutputSpec | null);
    /**
     * 口语与字幕
     */
    localization?: (Localization | null);
    /**
     * 后期 fact card
     */
    fact_card?: (FactCard | null);
    /**
     * 市场事实溯源
     */
    market_data?: (MarketData | null);
    /**
     * Bible 与参考资产
     */
    references?: (References | null);
    /**
     * 后期叠加计划
     */
    post_production?: (PostProduction | null);
};

