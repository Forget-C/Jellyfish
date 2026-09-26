/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 本次请求的**参考音频**准入结论（可审计）。
 *
 * 术语（别和"最终成片的音轨"混为一谈）：
 *
 * - **参考音频**：作为**输入**进供应商请求（``audio_urls``）。本字段回答的正是
 * "本次请求会不会带它、带的是哪个地址、没带是为什么"；
 * - **最终成片的音轨**：成片里那条轨，来自供应商侧 ``generate_audio``（模型自己生成）；
 * 把已生成的音频混流/回贴成成片音轨是**另一条路径**，当前未实现。
 *
 * 准入口径：只有**公网 http(s)** 或 **``asset://``** 才允许进入请求；本机相对路径 /
 * 内网地址 / 供应商不接受的 data URL 在计划层就被排除（带 ``excluded_reason``）。
 */
export type VideoAudioPlanRead = {
    /**
     * 本次请求是否真的会携带参考音频（会进 audio_urls）
     */
    included?: boolean;
    /**
     * 绑定的音频 file_id（未绑定时为空）
     */
    file_id?: string;
    /**
     * **真正会进请求**的地址（公网 http(s) / asset:// / 供应商接受的 data URL）；未携带时为空
     */
    url?: string;
    /**
     * 绑定解析出的原始地址（可能是本机/内网/data URL，仅供技术详情，不会发给供应商）
     */
    declared_url?: string;
    /**
     * 未携带时的原因：未绑定 / 本机相对路径 / 内网地址 / 供应商不吃 data URL / 供应商不接受参考音频…
     */
    excluded_reason?: string;
    /**
     * 机器可读原因码：not_bound / opt_out / file_missing / vendor_unsupported / no_address / local_path / private_address / data_url_rejected；已携带时为空
     */
    reason_code?: string;
    /**
     * 未携带时的补救办法（可操作）
     */
    how_to_fix?: string;
    /**
     * 准入状态：public_url / asset_ref / data_url_inline（以上三者=携带）/ not_bound / opt_out / file_missing / vendor_unsupported / no_address / local_path / private_address / data_url_rejected
     */
    state?: string;
    /**
     * 当前供应商/模型是否声明接受参考音频（seedance 2.0 系列为 true）
     */
    vendor_supports_reference_audio?: boolean;
    /**
     * 术语澄清：参考音频（输入）≠ 最终成片音轨（输出侧 generate_audio）
     */
    note?: string;
};

