/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LlmTargetRead } from './LlmTargetRead';
/**
 * 一次编排运行的可观测信息。
 */
export type LlmRunMeta = {
    /**
     * 是否处于 DRY_RUN（true 表示未触网）
     */
    dry_run: boolean;
    /**
     * 是否真实调用了 LLM
     */
    llm_called: boolean;
    /**
     * 文本模型目标
     */
    target?: (LlmTargetRead | null);
    /**
     * 真实调用耗时（ms）；DRY_RUN 时为 null
     */
    latency_ms?: (number | null);
    /**
     * 模型原始输出字符数
     */
    raw_output_chars?: number;
    /**
     * JSON 抢救/修复动作
     */
    json_repairs?: Array<string>;
    /**
     * JSON 解析失败原因（失败路径）
     */
    json_parse_error?: (string | null);
    /**
     * DRY_RUN 拦截原因
     */
    dry_run_reason?: (string | null);
};

