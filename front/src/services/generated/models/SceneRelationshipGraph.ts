/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignApplicability } from './DesignApplicability';
import type { DesignScopeIssue } from './DesignScopeIssue';
import type { RelationshipEdge } from './RelationshipEdge';
import type { RelationshipNode } from './RelationshipNode';
import type { RelationshipPath } from './RelationshipPath';
import type { RelationshipUse } from './RelationshipUse';
/**
 * 与读取的版本修订一同生成的只读关系投影。
 */
export type SceneRelationshipGraph = {
    version_id: string;
    revision: number;
    nodes: Array<RelationshipNode>;
    edges: Array<RelationshipEdge>;
    paths: Array<RelationshipPath>;
    uses: Array<RelationshipUse>;
    applicability: Array<DesignApplicability>;
    complete?: boolean;
    issues?: Array<DesignScopeIssue>;
    preparation_issues?: Array<DesignScopeIssue>;
};
