/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneTakeAnnotation_Input } from './SceneTakeAnnotation_Input';
/**
 * 同一素材在当前版本的独立判断，文件身份必须与原 Take 一致。
 */
export type SceneTakeJudgment_Input = {
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    file_id: string;
    annotation: SceneTakeAnnotation_Input;
};
