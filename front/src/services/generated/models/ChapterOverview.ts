/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SequenceOverview } from './SequenceOverview';
/**
 * 章节有序场次的轻量概览，不携带设计、计划或工作区正文。
 */
export type ChapterOverview = {
    chapter_id: string;
    title: string;
    source_version: string;
    sequences: Array<SequenceOverview>;
};
