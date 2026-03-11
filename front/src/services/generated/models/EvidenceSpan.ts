/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 可追溯证据：原文定位（chunk + 起止位置/摘录），用于审核与回查。
 */
export type EvidenceSpan = {
    /**
     * 输入文本块的唯一ID（例如 chapter1_p03）
     */
    chunk_id: string;
    /**
     * 在该 chunk 中的起始字符位置（可选）
     */
    start_char?: (number | null);
    /**
     * 在该 chunk 中的结束字符位置（可选）
     */
    end_char?: (number | null);
    /**
     * 不超过200字的原文摘录（可选，便于人工审核）
     */
    quote?: (string | null);
};

