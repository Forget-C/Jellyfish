/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasResultOrderAnchor } from './CanvasResultOrderAnchor';
import type { CanvasResultScope } from './CanvasResultScope';
/**
 * 候选连接只描述来源和用途，不代表实际使用。
 */
export type GenerationCanvasEdge = {
    id: string;
    source_card: string;
    source_port: string;
    target_card: string;
    target_port: string;
    result_scope?: (CanvasResultScope | null);
    order_anchor?: (CanvasResultOrderAnchor | null);
};
