/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EntityProfileCardRead } from './EntityProfileCardRead';
import type { ImagePromptSlotRead } from './ImagePromptSlotRead';
import type { LlmRunMeta } from './LlmRunMeta';
/**
 * 图片提示词预览结果（不落库）。
 */
export type ImagePromptPreviewRead = {
    shot_id?: (string | null);
    project_id?: (string | null);
    shot_text_chars?: number;
    slots?: Array<ImagePromptSlotRead>;
    entity_cards?: Array<EntityProfileCardRead>;
    warnings?: Array<string>;
    meta: LlmRunMeta;
    /**
     * 边界说明
     */
    note?: string;
};

