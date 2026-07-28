/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VideoFrameMediaReferences } from './VideoFrameMediaReferences';
import type { VideoSubjectMediaReference } from './VideoSubjectMediaReference';
/**
 * 视频参考媒体：帧槽位与命名主体分组必须独立保存。
 */
export type VideoMediaInput_Output = {
    frames?: VideoFrameMediaReferences;
    subjects?: Array<VideoSubjectMediaReference>;
};

