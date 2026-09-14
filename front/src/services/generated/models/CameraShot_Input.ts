/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 摄影意图、可见效果和技术要求，不等同于供应商参数。
 */
export type CameraShot_Input = {
    shot_id: string;
    composition: Note_Input;
    depth_layers: Note_Input;
    viewpoint: Note_Input;
    position: Note_Input;
    height_angle: Note_Input;
    lens_effect: Note_Input;
    depth_focus: Note_Input;
    support: Note_Input;
    movement_start: Note_Input;
    movement_trigger: Note_Input;
    movement_path: Note_Input;
    movement_speed: Note_Input;
    end_frame: Note_Input;
    light_sources: Note_Input;
    light_regions: Note_Input;
    exposure_color: Note_Input;
    optical_effects: Note_Input;
    motion_texture: Note_Input;
    technical_parameters: Note_Input;
    adjacent_requirements: Note_Input;
    prohibitions: Note_Input;
    criterion_ids: Array<string>;
};

