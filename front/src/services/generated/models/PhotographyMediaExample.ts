/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 摄影示例可定位明确声明的字段，文件仍不随文本采用。
 */
export type PhotographyMediaExample = {
    id: string;
    source: OutputIdentity;
    file_id: string;
    purpose?: 'positive' | 'negative';
    field_id?: ('shot_size' | 'composition' | 'frame_position' | 'depth_layers' | 'negative_space' | 'composition_requirements' | 'viewpoint' | 'position' | 'height_angle' | 'lens_effect' | 'support' | 'movement_type' | 'movement_start' | 'movement_trigger' | 'movement_path' | 'movement_speed' | 'end_frame' | 'light_sources' | 'light_direction' | 'light_regions' | 'exposure_color' | 'color_relationship' | 'depth_focus' | 'focus_change' | 'optical_effects' | 'motion_texture' | 'technical_parameters' | 'adjacent_requirements' | 'prohibitions' | null);
    description?: string;
    start_ms?: (number | null);
    end_ms?: (number | null);
};

