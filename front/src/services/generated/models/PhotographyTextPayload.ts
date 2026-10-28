/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CriterionReferencePayload } from './CriterionReferencePayload';
import type { DesignScope } from './DesignScope';
import type { FrameState } from './FrameState';
import type { NarrativeReferencePayload } from './NarrativeReferencePayload';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { PhotographyAdoptionScope } from './PhotographyAdoptionScope';
import type { PhotographyEntry } from './PhotographyEntry';
import type { PhotographyObjectUse } from './PhotographyObjectUse';
import type { PhotographyRequirement } from './PhotographyRequirement';
/**
 * 本卡发布的摄影文本与可采用范围，不包含示例文件或祖先正文。
 */
export type PhotographyTextPayload = {
    kind?: 'photography';
    text: string;
    requirements?: Array<PhotographyRequirement>;
    entries: Array<PhotographyEntry>;
    adoption_scopes: Array<PhotographyAdoptionScope>;
    frame_states?: Array<FrameState>;
    requires_frame_target?: boolean;
    scope: DesignScope;
    object_uses?: Array<PhotographyObjectUse>;
    objects?: Array<ObjectReferencePayload>;
    shot?: (NarrativeReferencePayload | null);
    source_locator?: string;
    acceptance_basis?: Array<CriterionReferencePayload>;
};
