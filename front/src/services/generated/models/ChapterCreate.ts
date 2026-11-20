/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterStatus } from './ChapterStatus';
import type { SourceExplanation } from './SourceExplanation';
export type ChapterCreate = {
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
    /**
     * 章节 ID
     */
    id: string;
};
