/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EntityProfileInput } from './EntityProfileInput';
/**
 * 视频提示词预览请求。
 */
export type VideoPromptPreviewRequest = {
    /**
     * 镜头 ID（用于装载上下文包）
     */
    shot_id?: (string | null);
    /**
     * 直接传入的镜头文本
     */
    shot_text?: (string | null);
    /**
     * 首帧图引用（URL/文件 ID）
     */
    first_frame_image_ref?: (string | null);
    /**
     * 尾帧图引用（URL/文件 ID）
     */
    last_frame_image_ref?: (string | null);
    /**
     * 运镜词；会被归一化到标准词库
     */
    camera_movement?: (string | null);
    /**
     * 期望时长（秒）
     */
    duration_seconds?: (number | null);
    /**
     * 帧模式；给尾帧引用时默认 first_last_frame
     */
    frame_mode?: ('single_frame' | 'first_last_frame' | null);
    /**
     * 项目 ID
     */
    project_id?: (string | null);
    /**
     * 实体画像（可选）
     */
    entity_profiles?: Array<EntityProfileInput>;
    /**
     * 风格提示
     */
    style_hint?: string;
    /**
     * 全局负面提示词
     */
    negative_prompt?: string;
    /**
     * 附加要求（可选）
     */
    extra_instructions?: string;
};

