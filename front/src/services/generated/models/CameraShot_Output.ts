/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 摄影意图、可见效果和技术要求，不等同于供应商参数。
 */
export type CameraShot_Output = {
    shot_id: string;
    composition: Note_Output;
    depth_layers: Note_Output;
    viewpoint: Note_Output;
    position: Note_Output;
    height_angle: Note_Output;
    lens_effect: Note_Output;
    depth_focus: Note_Output;
    support: Note_Output;
    movement_start: Note_Output;
    movement_trigger: Note_Output;
    movement_path: Note_Output;
    movement_speed: Note_Output;
    end_frame: Note_Output;
    light_sources: Note_Output;
    light_regions: Note_Output;
    exposure_color: Note_Output;
    optical_effects: Note_Output;
    motion_texture: Note_Output;
    technical_parameters: Note_Output;
    adjacent_requirements: Note_Output;
    prohibitions: Note_Output;
    criterion_ids: Array<string>;
};

