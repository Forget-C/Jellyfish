/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 从小说中抽取的角色：主名、别名、外貌与性格、服装描述、首次出场证据及抽取置信度。
 */
export type Character = {
    /**
     * 稳定ID，例如 char_001
     */
    id: string;
    /**
     * 主名称（尽量取原文最常用的称呼）
     */
    name: string;
    /**
     * 归一化主名，如将「王二/二哥/王二哥」统一为同一主名（来自文本）
     */
    normalized_name?: (string | null);
    /**
     * 别名/称呼（原文出现过的）
     */
    aliases?: Array<string>;
    /**
     * 外貌/身份/气质（忠实原文，与服装区分）
     */
    description?: (string | null);
    /**
     * 从原文抽取的服装/造型描述（如款式、颜色、配饰），与 description 区分，便于后续关联服装资产
     */
    costume_note?: (string | null);
    /**
     * 性格/特征词（尽量来自原文）
     */
    traits?: Array<string>;
    /**
     * 抽取确定度 0-1（模型输出）
     */
    confidence?: (number | null);
    first_appearance?: (EvidenceSpan | null);
};

