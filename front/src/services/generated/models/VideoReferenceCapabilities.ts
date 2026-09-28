/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前适配器可传递的参考范围；空数量上限表示未知，不保证模型创作效果。
 */
export type VideoReferenceCapabilities = {
    model_id: string;
    frame_roles: Array<'first_frame' | 'last_frame' | 'key_frame'>;
    max_frames?: (number | null);
    subject_images: boolean;
    subject_videos: boolean;
    combine_subjects_and_frames: boolean;
    max_subjects?: (number | null);
    max_images_per_subject?: (number | null);
    max_videos_per_subject?: (number | null);
    max_media_per_subject?: (number | null);
    max_total_subject_videos?: (number | null);
    limits_status: 'known' | 'partial';
};
