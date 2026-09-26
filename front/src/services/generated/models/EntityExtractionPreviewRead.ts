/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DroppedEntityRead } from './DroppedEntityRead';
import type { EntityDraftItemRead } from './EntityDraftItemRead';
import type { LlmRunMeta } from './LlmRunMeta';
/**
 * 实体提取预览结果（草稿，不落库）。
 */
export type EntityExtractionPreviewRead = {
    chapter_id?: (string | null);
    source_chars?: number;
    items?: Array<EntityDraftItemRead>;
    dropped?: Array<DroppedEntityRead>;
    warnings?: Array<string>;
    meta: LlmRunMeta;
    /**
     * 边界说明
     */
    note?: string;
};

