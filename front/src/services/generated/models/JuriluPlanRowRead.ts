/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 配对计划中的一行（统一预览直接照抄即可）。
 */
export type JuriluPlanRowRead = {
    action: string;
    order: number;
    label: string;
    summary: string;
    prompt: string;
    source: string;
    reason?: string;
    shot_id?: string;
    index?: number;
    title?: string;
    /**
     * 这一行来自哪个脚本组（scriptId）
     */
    script_id?: string;
    /**
     * 巨日禄分镜序号（seqNum）
     */
    seq?: number;
    /**
     * 怎么配上的：seq（编号优先）/ order（顺序兜底）/ created（新建）/ none
     */
    matched_by?: string;
};

