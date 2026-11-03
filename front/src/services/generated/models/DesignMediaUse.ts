/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 视频接收端对设计实际携带素材的用途；不创建候选或采用关系。
 */
export type DesignMediaUse = {
    id: string;
    source: OutputIdentity;
    input_port: 'first_frame' | 'last_frame' | 'key_frame' | 'subject_image' | 'subject_video';
    subject_name?: (string | null);
};
