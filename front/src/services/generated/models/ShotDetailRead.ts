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
     * 分镜级视频比例覆盖；为空表示继承项目默认
     */
    override_video_ratio?: (string | null);
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
    /**
     * 动作拍点（按时间顺序排列）
     */
    action_beats?: Array<string>;
    /**
     * 镜头分镜首帧提示词
     */
    first_frame_prompt?: string;
    /**
     * 镜头分镜尾帧提示词
     */
    last_frame_prompt?: string;
    /**
     * 镜头分镜关键帧提示词
     */
    key_frame_prompt?: string;
    /**
     * 该镜头使用的音频文件 ID（files.type=audio）；声音绑定落在这里
     */
    audio_file_id?: (string | null);
    /**
     * 本镜明确标记无需声音（与 audio_file_id 互斥，默认 false=未表态）
     */
    audio_opt_out?: boolean;
    /**
     * 镜头视频提示词（文生视频用；与帧图片提示词分离，可由外部平台导入）
     */
    video_prompt?: string;
    /**
     * 视频提示词来源标记（jurilu / external / manual / internal；空表示未知）
     */
    video_prompt_source?: string;
};

