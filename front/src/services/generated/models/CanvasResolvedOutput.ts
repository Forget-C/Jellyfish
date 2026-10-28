/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CriterionReferencePayload } from './CriterionReferencePayload';
import type { DescriptionTextPayload } from './DescriptionTextPayload';
import type { DesignTextPayload } from './DesignTextPayload';
import type { MediaOutputPayload } from './MediaOutputPayload';
import type { NamedImagePayload } from './NamedImagePayload';
import type { NarrativeReferencePayload } from './NarrativeReferencePayload';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { OutputIdentity } from './OutputIdentity';
import type { PhotographyTextPayload } from './PhotographyTextPayload';
import type { SpatialReferencePayload } from './SpatialReferencePayload';
import type { TextOutputPayload } from './TextOutputPayload';
/**
 * 已发布的实际输出，运行层可注入模型当前输出而无需虚构未来结果。
 */
export type CanvasResolvedOutput = {
    source: OutputIdentity;
    modality: string;
    payload?: ((TextOutputPayload | MediaOutputPayload | ObjectReferencePayload | DescriptionTextPayload | NamedImagePayload | DesignTextPayload | SpatialReferencePayload | NarrativeReferencePayload | CriterionReferencePayload | PhotographyTextPayload) | null);
    text?: (string | null);
    file_id?: (string | null);
    token?: string;
    available?: boolean;
    basis_current?: boolean;
    result_set_id?: (string | null);
};
