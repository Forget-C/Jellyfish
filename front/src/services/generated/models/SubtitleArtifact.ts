/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一条字幕产物（WebVTT）在导入结果中的表示。
 */
export type SubtitleArtifact = {
    /**
     * Jellyfish files.id
     */
    file_id: string;
    /**
     * BCP 47 语言标签，如 zh-Hant
     */
    language_tag: string;
    /**
     * 对象存储 key（确定性）
     */
    storage_key: string;
    /**
     * cue 数量
     */
    cue_count: number;
    /**
     * WebVTT 字节数
     */
    byte_size: number;
    /**
     * true=本次新建；false=复用既有产物并就地更新
     */
    created: boolean;
};

