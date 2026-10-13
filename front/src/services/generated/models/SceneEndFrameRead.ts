/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneMediaCutItem_Output } from './SceneMediaCutItem_Output';
import type { Source } from './Source';
/**
 * 固定真实帧时间及原采用区间，单独表达当前适用性与文件可用性。
 */
export type SceneEndFrameRead = {
    id: string;
    version_id: string;
    request_id: string;
    revision: number;
    clip: SceneMediaCutItem_Output;
    file_id: string;
    at_ms: number;
    source: Source;
    created_at: string;
    matches_current: boolean;
    available: boolean;
    image_url: (string | null);
};
