/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasTarget } from './CanvasTarget';
/**
 * 业务边必须有来源证据；结构引导线单独分类。
 */
export type CanvasEdge = {
    id: string;
    source: string;
    target?: (string | null);
    target_group?: (string | null);
    kind: 'business' | 'guide';
    label: string;
    sources?: Array<CanvasTarget>;
    category?: 'design' | 'evidence' | 'criterion' | 'constraint' | 'input';
};
