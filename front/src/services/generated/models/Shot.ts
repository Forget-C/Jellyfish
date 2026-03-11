/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DialogueLine } from './DialogueLine';
import type { EvidenceSpan } from './EvidenceSpan';
import type { VFXNote } from './VFXNote';
/**
 * 单镜头：景别/机位/运镜、时长与画面描述、对白列表、音效与视效、关联角色与道具。
 */
export type Shot = {
    /**
     * 例如 shot_001_003（scene_001 第3镜）
     */
    id: string;
    /**
     * 所属 scene_xxx
     */
    scene_id: string;
    /**
     * 场景内镜头序号，从1开始
     */
    order: number;
    shot_type: 'ECU' | 'CU' | 'MCU' | 'MS' | 'MLS' | 'LS' | 'ELS';
    camera_angle?: 'EYE_LEVEL' | 'HIGH_ANGLE' | 'LOW_ANGLE' | 'BIRD_EYE' | 'DUTCH' | 'OVER_SHOULDER';
    camera_movement?: 'STATIC' | 'PAN' | 'TILT' | 'DOLLY_IN' | 'DOLLY_OUT' | 'TRACK' | 'CRANE' | 'HANDHELD' | 'STEADICAM' | 'ZOOM_IN' | 'ZOOM_OUT';
    /**
     * 建议时长（可选）
     */
    duration_sec?: (number | null);
    /**
     * 镜头里发生的动作/画面（行业口吻，简短可拍）
     */
    description: string;
    character_ids?: Array<string>;
    prop_ids?: Array<string>;
    vfx?: Array<VFXNote>;
    /**
     * 音效提示，如 footsteps, rain, explosion（可选）
     */
    sfx?: Array<string>;
    /**
     * 该镜头内的对白列表（结构化：说话人、对象、情绪、旁白/电话等、时间点）
     */
    dialogue_lines?: Array<DialogueLine>;
    /**
     * [兼容] 若该镜头承载关键对白，可摘录/概述（可选）
     */
    dialogue?: (string | null);
    /**
     * 对应原文依据（可选）
     */
    evidence?: Array<EvidenceSpan>;
};

