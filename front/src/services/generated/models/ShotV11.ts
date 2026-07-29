/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraSpec } from './CameraSpec';
import type { DialogueLine } from './DialogueLine';
import type { RegenerationFallback } from './RegenerationFallback';
/**
 * v1.1 镜头：在 v1 ``Shot`` 之上仅新增五个可选字段。
 *
 * 刻意不新增：连续性字段（用 ``continuity_notes``）、运镜字段（用 ``camera.movement``）、
 * 任何镜头相对时间字段。
 */
export type ShotV11 = {
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
    /**
     * 起始状态（生成用）
     */
    beginning_state?: string;
    /**
     * 结束状态（生成用）
     */
    ending_state?: string;
    /**
     * 已知生成风险
     */
    generation_risks?: Array<string>;
    /**
     * 仅恢复用兜底方案
     */
    regeneration_fallback?: (RegenerationFallback | null);
    /**
     * 关联的后期叠加 ID
     */
    overlay_ids?: Array<string>;
};

