/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraAngle } from './CameraAngle';
import type { CameraMovement } from './CameraMovement';
import type { CameraShotType } from './CameraShotType';
import type { VFXType } from './VFXType';
export type ShotDetailUpdate = {
    camera_shot?: (CameraShotType | null);
    angle?: (CameraAngle | null);
    movement?: (CameraMovement | null);
    scene_id?: (string | null);
    duration?: (number | null);
    override_video_ratio?: (string | null);
    mood_tags?: (Array<string> | null);
    atmosphere?: (string | null);
    follow_atmosphere?: (boolean | null);
    has_bgm?: (boolean | null);
    vfx_type?: (VFXType | null);
    vfx_note?: (string | null);
    action_beats?: (Array<string> | null);
    first_frame_prompt?: (string | null);
    last_frame_prompt?: (string | null);
    key_frame_prompt?: (string | null);
    video_prompt?: (string | null);
    video_prompt_source?: (string | null);
    /**
     * 该镜头使用的音频文件 ID（files.type=audio）
     */
    audio_file_id?: (string | null);
    /**
     * 本镜**明确标记**无需声音。与 audio_file_id 互斥：置 true 时服务端会清空 audio_file_id；绑定音频时服务端会把本字段置 false。
     */
    audio_opt_out?: (boolean | null);
};

