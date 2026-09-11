/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StudioCharacterDraft } from './StudioCharacterDraft';
import type { StudioCostumeDraft } from './StudioCostumeDraft';
import type { StudioPropDraft } from './StudioPropDraft';
import type { StudioSceneDraft } from './StudioSceneDraft';
import type { StudioShotDraft } from './StudioShotDraft';
/**
 * 用于导入 Studio 的提取结果草稿（name-based）。
 */
export type StudioScriptExtractionDraft = {
    /**
     * 项目 ID（必填）
     */
    project_id: string;
    /**
     * 章节 ID（必填，用于创建 shots/links）
     */
    chapter_id: string;
    /**
     * 剧本文本（可为优化后版本）
     */
    script_text: string;
    characters?: Array<StudioCharacterDraft>;
    scenes?: Array<StudioSceneDraft>;
    props?: Array<StudioPropDraft>;
    costumes?: Array<StudioCostumeDraft>;
    /**
     * 镜头草稿列表
     */
    shots?: Array<StudioShotDraft>;
};

