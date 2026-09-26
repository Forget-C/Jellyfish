/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 实体提取预览请求。
 *
 * ``chapter_id`` 与 ``chapter_text`` 至少给一个；同时给出时以 ``chapter_text`` 为准。
 */
export type EntityExtractionPreviewRequest = {
    /**
     * 章节 ID（从 DB 读取原文）
     */
    chapter_id?: (string | null);
    /**
     * 直接传入的剧本/章节文本
     */
    chapter_text?: (string | null);
    /**
     * 候选实体名白名单；非空时不在名单内的实体视为幻觉并丢弃
     */
    candidate_names?: Array<string>;
    /**
     * 最多返回条数
     */
    max_items?: number;
    /**
     * 附加要求（可选）
     */
    extra_instructions?: string;
};

