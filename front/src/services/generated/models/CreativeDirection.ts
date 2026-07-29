/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一集的创意方向：格式、基调、时长目标与风格。
 */
export type CreativeDirection = {
    /**
     * 内容格式（如 short_form_vertical）
     */
    format?: string;
    /**
     * 整体基调（如 deadpan、satirical）
     */
    tone?: string;
    /**
     * 目标时长（秒），必须大于零
     */
    target_duration_seconds: number;
    /**
     * 视觉风格（如 anime、cel-shaded）
     */
    visual_style?: string;
    /**
     * 喜剧风格（如 false_confidence + callback）
     */
    comedy_style?: string;
    /**
     * 连续性备注：跨集/跨镜需保持的设定
     */
    continuity_notes?: string;
};

