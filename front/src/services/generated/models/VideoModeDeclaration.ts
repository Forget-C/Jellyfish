/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VideoDurationRange } from './VideoDurationRange';
/**
 * 按操作和分辨率保存视频参数与参考限制。
 */
export type VideoModeDeclaration = {
    supported?: (boolean | null);
    ratios?: (Array<string> | null);
    duration_by_resolution?: Record<string, (VideoDurationRange | Array<number>)>;
    reference_kinds?: (Array<'image' | 'video' | 'audio'> | null);
    max_references?: (number | null);
    combine_subjects_and_frames?: (boolean | null);
    audio_reference_input?: (boolean | null);
    native_audio_output?: (boolean | null);
    audio_switch?: (boolean | null);
};
