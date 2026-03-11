/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 场景：内/外景、时间、关联地点与人物/道具，含原文标题与系统格式化标题。
 */
export type Scene = {
    /**
     * 例如 scene_001
     */
    id: string;
    /**
     * 来自原文的场景标题（若存在）
     */
    raw_title?: (string | null);
    /**
     * 系统生成的影视格式标题，如 INT. 地点 - TIME
     */
    formatted_title?: (string | null);
    interior?: 'INT' | 'EXT' | 'INT_EXT' | 'UNKNOWN';
    time_of_day?: 'DAY' | 'NIGHT' | 'DAWN' | 'DUSK' | 'UNKNOWN';
    /**
     * loc_xxx，如可判定
     */
    location_id?: (string | null);
    /**
     * 场景发生了什么（忠实原文，短）
     */
    summary?: (string | null);
    /**
     * 该场景出现的人物ID
     */
    character_ids?: Array<string>;
    /**
     * 该场景关键道具ID
     */
    prop_ids?: Array<string>;
    /**
     * 支持该场景的证据片段（可多条）
     */
    evidence?: Array<EvidenceSpan>;
};

