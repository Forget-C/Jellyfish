/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一集的生成元信息（用于追溯）。
 */
export type EpisodeMetadata = {
    /**
     * 生成时间（ISO-8601 字符串，可选）
     */
    created_at?: (string | null);
    /**
     * 生成器标识（如 creative-os）
     */
    generator?: string;
    /**
     * 所用模型标识
     */
    model?: string;
    /**
     * 提示词版本
     */
    prompt_version?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
};

