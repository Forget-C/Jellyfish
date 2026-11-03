/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaReference } from './MediaReference';
/**
 * 视频帧槽位，保留首帧、尾帧和关键帧的时间语义。
 */
export type VideoFrameMediaReferences = {
    first?: (MediaReference | null);
    last?: (MediaReference | null);
    keys?: Array<MediaReference>;
};

