/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterSequenceRead } from './ChapterSequenceRead';
import type { TransitionRead } from './TransitionRead';
/**
 * 有序播放和跨场审查不创建第二份可编辑剪辑真值。
 */
export type ChapterAssemblyRead = {
    chapter_id: string;
    title: string;
    sequences: Array<ChapterSequenceRead>;
    transitions: Array<TransitionRead>;
    gaps: Array<string>;
};
