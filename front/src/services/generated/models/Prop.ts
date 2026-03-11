/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 从小说中抽取的道具：名称、类别、外观/用途、归属角色及首次出场证据、置信度。
 */
export type Prop = {
    /**
     * 稳定ID，例如 prop_001
     */
    id: string;
    /**
     * 道具名称（原文）
     */
    name: string;
    /**
     * 归一化名称（来自文本）
     */
    normalized_name?: (string | null);
    /**
     * 可选：weapon/document/vehicle/clothing/device/magic_item/other
     */
    category?: (string | null);
    /**
     * 外观/用途（忠实原文）
     */
    description?: (string | null);
    /**
     * 拥有者（如果明确）
     */
    owner_character_id?: (string | null);
    /**
     * 抽取确定度 0-1（模型输出）
     */
    confidence?: (number | null);
    first_appearance?: (EvidenceSpan | null);
};

