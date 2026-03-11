/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Character } from './Character';
import type { Location } from './Location';
import type { Prop } from './Prop';
import type { Uncertainty } from './Uncertainty';
/**
 * 实体抽取结果（复用 runtime schemas 的 Character/Location/Prop）。
 */
export type FilmEntityExtractionResult = {
    /**
     * 小说/章节标识，例如 novel_x_ch05
     */
    source_id: string;
    /**
     * 如 zh/en（可选）
     */
    language?: (string | null);
    /**
     * 抽取器版本（可选）
     */
    extraction_version?: (string | null);
    /**
     * schemas 版本（可选）
     */
    schema_version?: (string | null);
    /**
     * 本次处理的 chunk_id 列表
     */
    chunks?: Array<string>;
    characters?: Array<Character>;
    locations?: Array<Location>;
    props?: Array<Prop>;
    /**
     * 全局备注（可选）
     */
    notes?: Array<string>;
    /**
     * 结构化不确定项
     */
    uncertainties?: Array<Uncertainty>;
};

