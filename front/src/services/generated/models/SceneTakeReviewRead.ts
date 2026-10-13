/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
/**
 * 保存修订只用于定位记录形成时刻，适用性不改写固定内容。
 */
export type SceneTakeReviewRead = {
    id: string;
    version_id: string;
    revision: number;
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    content: SceneVersionContent_Output;
    created_at: string;
    matches_current: boolean;
};
