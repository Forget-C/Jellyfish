/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 登记外部公网素材（不下载、不存副本）。
 */
export type ExternalFileCreate = {
    /**
     * 公网可访问地址（http/https）
     */
    url: string;
    /**
     * 显示名（缺省取 URL 文件名）
     */
    name?: (string | null);
    /**
     * 素材类型：image / video / audio（缺省按后缀推断）
     */
    type?: (string | null);
    /**
     * 与 usage_kind 同时提供时写入 file_usages
     */
    project_id?: (string | null);
    chapter_id?: (string | null);
    shot_id?: (string | null);
    usage_kind?: (string | null);
    source_ref?: (string | null);
};

