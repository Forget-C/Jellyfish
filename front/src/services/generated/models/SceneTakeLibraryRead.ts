/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProductionPlan_Output } from './ProductionPlan_Output';
import type { Prompt } from './Prompt';
import type { SceneVideoPreparation } from './SceneVideoPreparation';
/**
 * 文件可用性为登记状态，播放和执行仍核验实际读取结果。
 */
export type SceneTakeLibraryRead = {
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    file_id: string;
    origin_id: string;
    unit_id: string;
    task_id: string;
    duration_ms: (number | null);
    available: boolean;
    media_url: (string | null);
    prompt?: (Prompt | null);
    production_plan?: (ProductionPlan_Output | null);
    video_preparation?: (SceneVideoPreparation | null);
};
