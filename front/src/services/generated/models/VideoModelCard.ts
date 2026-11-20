/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDetachedResult } from './CanvasDetachedResult';
import type { DesignMediaUse } from './DesignMediaUse';
import type { GeneratedVideoPrompt } from './GeneratedVideoPrompt';
import type { InputBinding } from './InputBinding';
import type { PromptDocument } from './PromptDocument';
import type { VideoModelConfig } from './VideoModelConfig';
/**
 * 视频处理卡；目标端口固定帧与主体用途。
 */
export type VideoModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    /**
     * 在画布展开正式结果，仅控制显示
     */
    show_result_cards?: boolean;
    detached_results?: Array<CanvasDetachedResult>;
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    generated_prompt?: (GeneratedVideoPrompt | null);
    config?: VideoModelConfig;
    design_media_uses?: Array<DesignMediaUse>;
};
