/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraSpec } from './CameraSpec';
import type { DialogueLine } from './DialogueLine';
/**
 * 一个镜头（storyboard 中的 shot），直接映射为 Jellyfish 的 Shot/ShotDetail。
 *
 * 说明：
 * - ``camera`` 为结构化对象（``CameraSpec``），字段对齐 Jellyfish ShotDetail 的
 * camera_shot/angle/movement，便于后续导入器映射；取值由 CAS 本地枚举校验。
 * - ``duration_seconds`` 允许小数，必须大于零。
 */
export type Shot = {
    /**
     * 镜头 ID（本集内唯一，非空）
     */
    shot_id: string;
    /**
     * 镜头顺序（正整数，本集内唯一）
     */
    sequence: number;
    /**
     * 镜头标题/分镜名
     */
    title?: string;
    /**
     * 镜头时长（秒），必须大于零
     */
    duration_seconds: number;
    /**
     * 镜头对应的剧本摘录
     */
    script_excerpt?: string;
    /**
     * 结构化相机描述（景别/角度/运镜，可选）
     */
    camera?: (CameraSpec | null);
    /**
     * 镜头内动作/视觉描述
     */
    action?: string;
    /**
     * 镜头内对白列表
     */
    dialogue?: Array<DialogueLine>;
    /**
     * 出场角色键（须存在于 characters）
     */
    character_keys?: Array<string>;
    /**
     * 场景键（可选；提供则须存在于 assets.scenes）
     */
    scene_key?: (string | null);
    /**
     * 道具键（须存在于 assets.props）
     */
    prop_keys?: Array<string>;
    /**
     * 服装键（须存在于 assets.costumes）
     */
    costume_keys?: Array<string>;
    /**
     * 图像生成提示词
     */
    image_prompt?: string;
    /**
     * 视频生成提示词
     */
    video_prompt?: string;
    /**
     * 反向提示词
     */
    negative_prompt?: string;
    /**
     * 镜头连续性备注
     */
    continuity_notes?: string;
    /**
     * 镜头级附加元信息
     */
    metadata?: Record<string, any>;
};

