/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasEdge } from './CanvasEdge';
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasView } from './CanvasView';
import type { InstructionCanvasNode } from './InstructionCanvasNode';
import type { UnitBasisCanvasNode } from './UnitBasisCanvasNode';
import type { UnitReferencesCanvasNode } from './UnitReferencesCanvasNode';
/**
 * 按明确单元进入的指令图，不要求用户先浏览全场概览。
 */
export type InstructionCanvasGraph = {
    kind: 'instructions';
    version_id: string;
    revision: number;
    nodes: Array<(InstructionCanvasNode | UnitReferencesCanvasNode | UnitBasisCanvasNode)>;
    edges: Array<CanvasEdge>;
    /**
     * 含一个 parent_id 为空的根视图；视图 ID 为后端提供的不透明地址
     */
    views: Array<CanvasView>;
    issues: Array<CanvasIssue>;
};
