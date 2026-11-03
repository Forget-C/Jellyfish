/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LogLevel } from './LogLevel';
/**
 * 更新或保存模型全局设置请求体。
 */
export type ModelSettingsUpdate = {
    /**
     * 默认文本模型 ID
     */
    default_text_model_id?: (string | null);
    /**
     * 默认图片模型 ID
     */
    default_image_model_id?: (string | null);
    /**
     * 默认视频模型 ID
     */
    default_video_model_id?: (string | null);
    /**
     * API 超时（秒）
     */
    api_timeout?: number;
    /**
     * 日志级别
     */
    log_level?: LogLevel;
};

