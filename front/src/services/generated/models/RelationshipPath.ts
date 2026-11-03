/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RelationshipEdge } from './RelationshipEdge';
/**
 * 间接到达只展示连续的真实字段引用，不创建可编辑边。
 */
export type RelationshipPath = {
    source: string;
    target: string;
    steps: Array<RelationshipEdge>;
};
