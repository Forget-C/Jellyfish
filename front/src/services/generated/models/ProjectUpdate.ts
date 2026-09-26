/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStartMode } from './ProjectStartMode';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
export type ProjectUpdate = {
    name?: (string | null);
    description?: (string | null);
    /**
     * 题材/风格（可用预设值，也可自定义）
     */
    style?: (string | null);
    visual_style?: (ProjectVisualStyle | null);
    seed?: (number | null);
    unify_style?: (boolean | null);
    progress?: (number | null);
    default_video_ratio?: (string | null);
    start_mode?: (ProjectStartMode | null);
    stats?: (Record<string, any> | null);
};

