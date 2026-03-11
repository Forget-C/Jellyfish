/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 从小说中抽取的地点：名称、类型、场景描写及首次出场证据、置信度。
 */
export type Location = {
    /**
     * 稳定ID，例如 loc_001
     */
    id: string;
    /**
     * 地点名称（原文）
     */
    name: string;
    /**
     * 归一化名称（来自文本）
     */
    normalized_name?: (string | null);
    /**
     * 地点类型：房间/街道/森林/车厢等（可选）
     */
    type?: (string | null);
    /**
     * 场景描写（忠实原文，简短）
     */
    description?: (string | null);
    /**
     * 抽取确定度 0-1（模型输出）
     */
    confidence?: (number | null);
    first_appearance?: (EvidenceSpan | null);
};

