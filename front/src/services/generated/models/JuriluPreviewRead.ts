/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { JuriluPlanRowRead } from './JuriluPlanRowRead';
import type { JuriluScriptGroupRead } from './JuriluScriptGroupRead';
/**
 * 预览结果：将要发生什么。
 */
export type JuriluPreviewRead = {
    project_id: string;
    chapter_id: string;
    chapter_shot_count: number;
    entry_count: number;
    plan_summary: string;
    counts: Record<string, number>;
    rows: Array<JuriluPlanRowRead>;
    /**
     * 镜头数不足、需要新建的条数
     */
    missing_shot_count?: number;
    /**
     * 脱敏后的抓取诊断
     */
    diagnostics?: Record<string, any>;
    warnings?: Array<string>;
    jurilu_project_id?: string;
    jurilu_clip_id?: string;
    source_url?: string;
    /**
     * 按 scriptId 分好的脚本组（默认不合并）
     */
    script_groups?: Array<JuriluScriptGroupRead>;
    selected_script_ids?: Array<string>;
    /**
     * 所选脚本组（单数语义，未选则空）
     */
    selected_script_id?: string;
    /**
     * true = 用户还没选组，本轮不做匹配、不写库
     */
    requires_script_selection?: boolean;
    /**
     * 口径说明（默认不跨 scriptId 合并 / 一次只能导入一个脚本组）
     */
    note?: string;
};

