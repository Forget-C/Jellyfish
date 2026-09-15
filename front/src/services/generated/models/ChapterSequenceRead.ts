/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ObservedRange } from './ObservedRange';
/**
 * 章节播放直接消费本场已确认粗剪，未验收场次明确显示缺口。
 */
export type ChapterSequenceRead = {
    sequence_id: string;
    title: string;
    position: number;
    cut_revision_id: (string | null);
    review_id: (string | null);
    verdict: 'unreviewed' | 'pass' | 'revise';
    sound_status: 'pending_postproduction' | 'reviewed' | 'not_applicable';
    source_changed: boolean;
    items: Array<ObservedRange>;
    timeline_starts_ms: Array<number>;
    duration_ms: number;
    gaps: Array<string>;
};
