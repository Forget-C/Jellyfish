/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasGroup } from './CanvasGroup';
import type { CanvasMember } from './CanvasMember';
/**
 * 服务端确定成员、可见边及导航目标；位置和视口属于浏览器。
 */
export type CanvasView = {
    id: string;
    title: string;
    parent_id: (string | null);
    anchor_id: (string | null);
    members: Array<CanvasMember>;
    edge_ids: Array<string>;
    groups: Array<CanvasGroup>;
    node_count: number;
    reference_count: number;
    card_count: number;
    issue_count: number;
};
