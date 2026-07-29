/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubtitleTrack } from './SubtitleTrack';
/**
 * 口语与字幕本地化。字幕结构上可选；必需语言只来自 required_publish_language_tags。
 */
export type Localization = {
    /**
     * 对白语言（缺省回落到根 language）
     */
    spoken_language?: (string | null);
    /**
     * 发布前必须具备字幕的语言标签；空表示无要求
     */
    required_publish_language_tags?: Array<string>;
    /**
     * 字幕轨列表
     */
    subtitle_tracks?: Array<SubtitleTrack>;
};

