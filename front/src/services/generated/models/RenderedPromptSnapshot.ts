/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FrameGuidanceDecisionSnapshot } from './FrameGuidanceDecisionSnapshot';
import type { FrameReferenceMappingSnapshot } from './FrameReferenceMappingSnapshot';
import type { ImageMediaInput } from './ImageMediaInput';
import type { JsonValue } from './JsonValue';
import type { PromptRendererName } from './PromptRendererName';
import type { VideoMediaInput_Output } from './VideoMediaInput_Output';
/**
 * 一次同步渲染的可展示、可审计快照，不能携带认证材料。
 */
export type RenderedPromptSnapshot = {
    render_id: string;
    renderer: PromptRendererName;
    execution_prompt: string;
    variables_snapshot: Record<string, JsonValue>;
    template_id?: (string | null);
    template_version?: (number | null);
    recommended_media?: (ImageMediaInput | VideoMediaInput_Output | null);
    warnings?: Array<string>;
    base_prompt?: (string | null);
    selected_guidance?: Array<string>;
    dropped_guidance?: Array<string>;
    selected_guidance_details?: Array<FrameGuidanceDecisionSnapshot>;
    dropped_guidance_details?: Array<FrameGuidanceDecisionSnapshot>;
    reference_mappings?: Array<FrameReferenceMappingSnapshot>;
};

