/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 同步提取保留进程内缓存及显式刷新选项。
 */
export type ScriptExtractRequest = {
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 章节 ID
     */
    chapter_id: string;
    /**
     * 分镜结果（ScriptDivisionResult 序列化）
     */
    script_division: Record<string, any>;
    /**
     * 一致性检查结果（可选；ScriptConsistencyCheckResult 序列化）
     */
    consistency?: (Record<string, any> | null);
    /**
     * 是否跳过后端缓存并强制重新提取
     */
    refresh_cache?: boolean;
};

