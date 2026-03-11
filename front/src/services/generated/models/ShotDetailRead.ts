/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraAngle } from './CameraAngle';
import type { CameraMovement } from './CameraMovement';
import type { CameraShotType } from './CameraShotType';
import type { VFXType } from './VFXType';
export type ShotDetailRead = {
    /**
     * 镜头 ID（与 shots.id 共享主键）
     */
    id: string;
    /**
     * 景别
     */
    camera_shot: CameraShotType;
    /**
     * 机位角度
     */
    angle: CameraAngle;
    /**
     * 运镜方式
     */
    movement: CameraMovement;
    /**
     * 关联场景 ID（可空）
     */
    scene_id?: (string | null);
    /**
     * 时长（秒）
     */
    duration?: number;
    /**
     * 情绪标签
     */
    mood_tags?: Array<string>;
    /**
     * 氛围描述
     */
    atmosphere?: string;
    /**
     * 是否沿用氛围
     */
    follow_atmosphere?: boolean;
    /**
     * 是否包含 BGM
     */
    has_bgm?: boolean;
    /**
     * 视效类型
     */
    vfx_type?: VFXType;
    /**
     * 视效说明
     */
    vfx_note?: string;
};

