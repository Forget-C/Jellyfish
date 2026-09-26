/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 定版参考图（垫图）解析结果。
 */
export type ReferenceImageRead = {
    asset_id: string;
    asset_type: string;
    file_id?: string;
    /**
     * 对象存储公共地址（OSS URL 优先）
     */
    url?: string;
    view_angle?: string;
    quality_level?: string;
    /**
     * 是否为人工定版主图
     */
    is_primary?: boolean;
    /**
     * is_primary / fallback
     */
    resolved_from?: string;
    warnings?: Array<string>;
};

