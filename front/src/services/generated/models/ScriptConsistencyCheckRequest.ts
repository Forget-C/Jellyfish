/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceExplanation } from './SourceExplanation';
/**
 * 原文一致性检查请求。
 */
export type ScriptConsistencyCheckRequest = {
    /**
     * 项目 ID（异步任务关联可选）
     */
    project_id?: (string | null);
    /**
     * 章节 ID（异步任务关联可选）
     */
    chapter_id?: (string | null);
    /**
     * 完整剧本文本
     */
    script_text: string;
    source_explanations?: (Array<SourceExplanation> | null);
};
