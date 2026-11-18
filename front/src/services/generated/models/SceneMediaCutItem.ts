/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
/**
 * 单次采用独立定位同场次原素材和文件，同一 Take 可重复采用。
 */
export type SceneMediaCutItem = {
    kind: string;
    id: string;
    take_id: string;
    media_range: MediaRange;
    timeline_start_ms: number;
    /**
     * 完整显示保留黑边；填满等比例居中裁切，逐次采用独立保存。
     */
    fit: 'contain' | 'cover';
    take_kind: 'production_plan' | 'scene_video';
    file_id: string;
};
