/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 写入 file_usages 的关联信息（与 FileItem 一并提交）。
 */
export type FileUsageWrite = {
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 章节 ID
     */
    chapter_id?: (string | null);
    /**
     * 镜头 ID
     */
    shot_id?: (string | null);
    /**
     * 用途：shot_frame / generated_video / chapter_master_video / character_image / asset_image / upload / api 等
     */
    usage_kind: string;
    /**
     * 幂等键（可选）
     */
    source_ref?: (string | null);
};

