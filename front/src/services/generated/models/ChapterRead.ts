/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterStatus } from './ChapterStatus';
import type { SourceExplanation } from './SourceExplanation';
export type ChapterRead = {
    /**
     * 所属项目 ID
     */
    project_id: string;
    /**
     * 章节序号（项目内唯一）
     */
    index: number;
    /**
     * 章节标题
     */
    title: string;
    /**
     * 章节摘要
     */
    summary?: string;
    /**
     * 章节原文
     */
    raw_text?: string;
    source_explanations?: (Array<SourceExplanation> | null);
    /**
     * 精简原文
     */
    condensed_text?: string;
    /**
     * 章节状态
     */
    status?: ChapterStatus;
    id: string;
    /**
     * 已确认场次数
     */
    sequence_count?: number;
    /**
     * 当前原文与全部解释的编辑基线。
     */
    readonly basis_version: string;
};
