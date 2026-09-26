/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 直提出视频的计划预览请求（不触网、不建任务）。
 */
export type VideoSubmitPlanRequest = {
    shot_id: string;
    /**
     * 参考图模式，对齐既有契约：first / last / key / first_last / first_last_key / text_only
     */
    reference_mode?: string;
    /**
     * 留空则由 P1 视频提示词服务生成
     */
    prompt?: string;
    /**
     * 显式参考图；为空则按 mode 解析
     */
    images?: Array<string>;
    /**
     * 视频比例
     */
    ratio?: string;
    duration_seconds?: (number | null);
    /**
     * 是否让模型自带音频（供应商开关，seedance 默认 true）。设为 false 时模型不会自己生成音频，便于验证参考音频是否被采用。
     */
    generate_audio?: (boolean | null);
};

