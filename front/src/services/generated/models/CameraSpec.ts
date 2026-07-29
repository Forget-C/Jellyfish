/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CasCameraAngle } from './CasCameraAngle';
import type { CasCameraMovement } from './CasCameraMovement';
import type { CasShotType } from './CasShotType';
/**
 * 镜头的结构化相机描述。
 *
 * v1.1 起将「camera 自由文本」升级为结构化对象，字段与 Jellyfish ShotDetail 的
 * ``camera_shot`` / ``angle`` / ``movement`` 概念一一对应，便于导入器干净映射。
 * 三个字段均可选（storyboard 未指定时留空）；取值由 CAS 本地枚举校验，
 * **不**从 Jellyfish ORM/枚举导入。
 */
export type CameraSpec = {
    /**
     * 景别（ECU/CU/MCU/MS/MLS/LS/ELS）
     */
    shot_type?: (CasShotType | null);
    /**
     * 机位角度（EYE_LEVEL/HIGH_ANGLE/LOW_ANGLE/BIRD_EYE/DUTCH/OVER_SHOULDER）
     */
    angle?: (CasCameraAngle | null);
    /**
     * 运镜（STATIC/PAN/TILT/DOLLY_IN/DOLLY_OUT/TRACK/CRANE/HANDHELD/STEADICAM/ZOOM_IN/ZOOM_OUT）
     */
    movement?: (CasCameraMovement | null);
};

