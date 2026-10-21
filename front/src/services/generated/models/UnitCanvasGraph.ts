/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasEdge } from './CanvasEdge';
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasView } from './CanvasView';
import type { MissingCanvasNode } from './MissingCanvasNode';
import type { ShotBasisCanvasNode } from './ShotBasisCanvasNode';
import type { UnitBasisCanvasNode } from './UnitBasisCanvasNode';
import type { UnitCanvasNode } from './UnitCanvasNode';
import type { UnitConfigCanvasNode } from './UnitConfigCanvasNode';
import type { UnitReferencesCanvasNode } from './UnitReferencesCanvasNode';
/**
 * 单元画布拥有独立载荷，复用共同结构与校验，不复用导演业务推断。
 */
export type UnitCanvasGraph = {
    kind: 'units';
    version_id: string;
    revision: number;
    nodes: Array<(ShotBasisCanvasNode | UnitCanvasNode | UnitConfigCanvasNode | UnitReferencesCanvasNode | UnitBasisCanvasNode | MissingCanvasNode)>;
    edges: Array<CanvasEdge>;
    views: Array<CanvasView>;
    issues: Array<CanvasIssue>;
};
