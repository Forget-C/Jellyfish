/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { JuriluSampleRecordRead } from './JuriluSampleRecordRead';
/**
 * 一个 scriptId = 一个脚本组（永远一条一组，默认不跨组合并）。
 */
export type JuriluScriptGroupRead = {
    script_id: string;
    title?: string;
    /**
     * 标题实际命中的字段名；取不到则空
     */
    title_source?: string;
    created_at?: string;
    /**
     * 创建时间实际命中的字段名；取不到则空
     */
    created_source?: string;
    updated_at?: string;
    /**
     * 更新时间实际命中的字段名；取不到则空
     */
    updated_source?: string;
    record_count?: number;
    seq_min?: string;
    seq_max?: string;
    /**
     * 序号取自哪个字段（seqNum / sbid；无则空）
     */
    seq_field?: string;
    /**
     * 该组分镜接口实际翻了几页（整组取全的证据）
     */
    pages_fetched?: number;
    sample_records?: Array<JuriluSampleRecordRead>;
    /**
     * 第一步记录的字段名列表（只有名字，不含值）
     */
    raw_keys?: Array<string>;
    /**
     * 客观事实逐条（记录数 / 序号范围 / 时间戳 / 与其他组的重合度）
     */
    facts?: Array<string>;
    /**
     * 只有在真实拿到可比较的时间戳且能分出先后时才为 true；无时间戳一律 false
     */
    likely_newest?: boolean;
    version_reasons?: Array<string>;
    version_hint?: string;
};

