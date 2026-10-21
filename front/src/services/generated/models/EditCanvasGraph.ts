/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasEdge } from './CanvasEdge';
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasView } from './CanvasView';
import type { EditClipCanvasNode } from './EditClipCanvasNode';
import type { EditCoverageCanvasNode } from './EditCoverageCanvasNode';
import type { EditCutReviewCanvasNode } from './EditCutReviewCanvasNode';
import type { EditDownstreamCanvasNode } from './EditDownstreamCanvasNode';
import type { EditEndFrameCanvasNode } from './EditEndFrameCanvasNode';
import type { EditPlannedCanvasNode } from './EditPlannedCanvasNode';
import type { EditSeamCanvasNode } from './EditSeamCanvasNode';
import type { EditTakeCanvasNode } from './EditTakeCanvasNode';
/**
 * 整场已保存采用总览；素材身份与采用身份分别表达。
 */
export type EditCanvasGraph = {
    kind: 'edit';
    version_id: string;
    revision: number;
    nodes: Array<(EditTakeCanvasNode | EditClipCanvasNode | EditPlannedCanvasNode | EditCoverageCanvasNode | EditSeamCanvasNode | EditCutReviewCanvasNode | EditEndFrameCanvasNode | EditDownstreamCanvasNode)>;
    edges: Array<CanvasEdge>;
    /**
     * 含一个 parent_id 为空的根视图；视图 ID 为后端提供的不透明地址
     */
    views: Array<CanvasView>;
    issues: Array<CanvasIssue>;
    library_view_id: (string | null);
};
