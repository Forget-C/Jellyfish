/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一条要写入镜头的提示词。
 *
 * **不接受调用方指定 source**：来源由请求级 ``origin``（流程）决定，见 `ORIGIN_TO_SOURCE`。
 * ``draft_token`` 仅在 ``origin=llm_draft`` 时需要，必须是后端签发的草稿令牌。
 * ``script_id`` 是这一条属于哪个巨日禄脚本组：只有 ``origin=jurilu_import`` 时参与校验
 * （必须与请求级 ``script_id`` **逐条一致**），其它来源不传即可。
 */
export type BoardEntryWrite = {
    shot_id: string;
    prompt: string;
    /**
     * 大模型草稿令牌（origin=llm_draft 时必填）
     */
    draft_token?: string;
    /**
     * 本条所属的巨日禄脚本组 ID（origin=jurilu_import 时必填且逐条一致）
     */
    script_id?: string;
};

