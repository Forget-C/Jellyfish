/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Character } from './Character';
import type { Location } from './Location';
import type { Prop } from './Prop';
import type { Scene } from './Scene';
import type { Shot } from './Shot';
import type { Transition } from './Transition';
import type { Uncertainty } from './Uncertainty';
/**
 * 从小说抽取的完整影视分镜：元信息、实体表、场景表、镜头表、转场表及不确定项。
 */
export type ProjectCinematicBreakdown = {
    /**
     * 小说/章节标识，例如 novel_x_ch05
     */
    source_id: string;
    /**
     * 书名/章节名（从书名页或章节头抽取）
     */
    source_title?: (string | null);
    /**
     * 作者（若可从文本抽取）
     */
    source_author?: (string | null);
    /**
     * 如 zh、en，便于后续提示词与分词
     */
    language?: (string | null);
    /**
     * 本次抽取器版本，便于回溯差异
     */
    extraction_version?: (string | null);
    /**
     * 本输出使用的 schema 版本
     */
    schema_version?: (string | null);
    /**
     * 本次处理的 chunk_id 列表
     */
    chunks?: Array<string>;
    characters?: Array<Character>;
    locations?: Array<Location>;
    props?: Array<Prop>;
    scenes?: Array<Scene>;
    shots?: Array<Shot>;
    transitions?: Array<Transition>;
    /**
     * 全局备注/不确定点（可选）
     */
    notes?: Array<string>;
    /**
     * 结构化不确定项：field_path、reason、evidence
     */
    uncertainties?: Array<Uncertainty>;
};

