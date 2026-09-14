/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 异步提取每次新建任务都执行生成，不提供进程内缓存选项。
 */
export type ScriptExtractAsyncRequest = {
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
};
