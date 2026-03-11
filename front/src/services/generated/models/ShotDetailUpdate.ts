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
    mood_tags?: (Array<string> | null);
    atmosphere?: (string | null);
    follow_atmosphere?: (boolean | null);
    has_bgm?: (boolean | null);
    vfx_type?: (VFXType | null);
    vfx_note?: (string | null);
};

