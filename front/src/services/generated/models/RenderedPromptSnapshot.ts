/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageMediaInput } from './ImageMediaInput';
import type { JsonValue } from './JsonValue';
import type { PromptRendererName } from './PromptRendererName';
import type { VideoMediaInput } from './VideoMediaInput';
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
    recommended_media?: (ImageMediaInput | VideoMediaInput | null);
    warnings?: Array<string>;
};

