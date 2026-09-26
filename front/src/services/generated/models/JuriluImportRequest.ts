/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 导入入参。字段命名对齐中控台面板的 5 个输入 + 2 个开关（外加脚本组选择）。
 */
export type JuriluImportRequest = {
    /**
     * 目标章节 ID（提示词写到这个章节的镜头上）
     */
    chapter_id: string;
    /**
     * 巨日禄页面 URL（需含 projectId / clipId）
     */
    url: string;
    /**
     * 整段「复制全部 Cookie」（不保存、不写日志）
     */
    cookie?: string;
    /**
     * Authorization 单值（可留空）
     */
    authorization?: string;
    /**
     * 自动 / 不发送 / 原样发送 / Bearer
     */
    auth_mode?: string;
    /**
     * Referer 覆盖（可留空）
     */
    referer?: string;
    /**
     * 高级：API 覆盖地址（可留空）
     */
    api_url_override?: string;
    /**
     * 分镜多于镜头时是否新建镜头
     */
    create_missing?: boolean;
    /**
     * 目标镜头已有不同提示词时是否覆盖
     */
    overwrite?: boolean;
    /**
     * 用户选择的脚本组：**一次只能传 1 个** scriptId。空数组 = 还没选组：只返回 script_groups，不做任何匹配（默认不跨 scriptId 合并）；传 2 个及以上会被 400 拒绝
     */
    script_ids?: Array<string>;
};

