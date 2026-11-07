/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AudioCapability } from './AudioCapability';
/**
 * 当前适配器真正接入的模态、用途、组合、数量及参数范围。
 */
export type CanvasModelCapability = {
    model_id: string;
    modality: 'text' | 'image' | 'video';
    input_ports: Array<string>;
    native_audio_output?: AudioCapability;
    ratios?: Array<string>;
    resolution_profiles?: Record<string, Record<string, string>>;
    min_count?: number;
    max_count?: number;
    max_reference_images?: (number | null);
    supports_duplicate_reference_images?: boolean;
    min_seconds?: (number | null);
    max_seconds?: (number | null);
    supports_seed?: boolean;
    supports_subject_reference_with_frame_reference?: boolean;
    max_subjects?: (number | null);
    max_images_per_subject?: (number | null);
    max_videos_per_subject?: (number | null);
    max_media_per_subject?: (number | null);
    max_total_subject_videos?: (number | null);
};
