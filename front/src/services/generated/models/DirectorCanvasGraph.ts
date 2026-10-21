/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasEdge } from './CanvasEdge';
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasView } from './CanvasView';
import type { DesignCanvasNode } from './DesignCanvasNode';
import type { MissingCanvasNode } from './MissingCanvasNode';
import type { SourceCanvasNode } from './SourceCanvasNode';
/**
 * 导演专属范围计数不变成所有画布的通用准备状态。
 */
export type DirectorCanvasGraph = {
    kind: 'director';
    version_id: string;
    revision: number;
    nodes: Array<(SourceCanvasNode | DesignCanvasNode | MissingCanvasNode)>;
    edges: Array<CanvasEdge>;
    views: Array<CanvasView>;
    issues: Array<CanvasIssue>;
    shot_count: number;
    pending_count: number;
    unlinked_count: number;
};
