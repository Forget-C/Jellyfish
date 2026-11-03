/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 服装信息缺失分析请求。
 */
export type CostumeInfoAnalysisRequest = {
    /**
     * 任务关联实体 ID（资产页恢复任务可选）
     */
    relation_entity_id?: (string | null);
    /**
     * 项目 ID（异步任务关联可选）
     */
    project_id?: (string | null);
    /**
     * 章节 ID（异步任务关联可选）
     */
    chapter_id?: (string | null);
    /**
     * 原文服装上下文（可为空；用于提供额外背景，帮助判断缺失信息）
     */
    costume_context?: (string | null);
    /**
     * 原文服装描述
     */
    costume_description: string;
};

