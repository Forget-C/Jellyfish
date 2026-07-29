/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubtitleCue } from './SubtitleCue';
/**
 * 一条字幕轨。渲染默认属于后期，不进入 AI 生成。
 */
export type SubtitleTrack = {
    /**
     * BCP 47 语言标签，如 zh-Hant
     */
    language_tag: string;
    /**
     * 是否为主轨
     */
    is_primary?: boolean;
    /**
     * 渲染方式（声明性；默认后期）
     */
    rendering?: 'post_production' | 'burned_in' | 'sidecar';
    /**
     * cue 列表（可为空，但后期阶段起视为无效）
     */
    cues: Array<SubtitleCue>;
};

