/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterStatus } from './ChapterStatus';
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
    /**
     * 精简原文
     */
    condensed_text?: string;
    /**
     * 分镜数量
     */
    storyboard_count?: number;
    /**
     * 章节状态
     */
    status?: ChapterStatus;
    id: string;
};

