/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraMovementResolvedRead } from './CameraMovementResolvedRead';
import type { LlmRunMeta } from './LlmRunMeta';
import type { ShotPromptCameraInfo } from './ShotPromptCameraInfo';
import type { ShotVideoPromptPackRead } from './ShotVideoPromptPackRead';
/**
 * 视频提示词预览结果；``pack`` 与 shot_video_prompt_pack 的结构对齐。
 */
export type VideoPromptPreviewRead = {
    shot_id?: (string | null);
    title?: string;
    /**
     * 镜头文本摘录
     */
    script_excerpt?: string;
    action_beats?: Array<string>;
    dialogue_summary?: string;
    /**
     * 镜头语言（含标准运镜词）
     */
    camera?: ShotPromptCameraInfo;
    camera_movement?: CameraMovementResolvedRead;
    frame_mode?: 'single_frame' | 'first_last_frame';
    duration_seconds?: number;
    subject_action?: string;
    expression_mood?: string;
    atmosphere?: string;
    first_frame_image_ref?: (string | null);
    last_frame_image_ref?: (string | null);
    first_frame_handling?: string;
    last_frame_handling?: string;
    final_prompt?: string;
    negative_prompt?: string;
    visual_style?: string;
    style?: string;
    /**
     * 镜头上下文包（仅 shot_id 可解析时填写）
     */
    pack?: (ShotVideoPromptPackRead | null);
    warnings?: Array<string>;
    meta: LlmRunMeta;
    /**
     * 边界说明
     */
    note?: string;
};

