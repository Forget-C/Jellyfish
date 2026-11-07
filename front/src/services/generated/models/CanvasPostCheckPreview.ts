/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckBasis } from './CanvasCheckBasis';
import type { CanvasCheckItem } from './CanvasCheckItem';
import type { CanvasCheckProduct } from './CanvasCheckProduct';
/**
 * 分别显示当前检查卡修订及历史生成依据，执行由用户明确触发。
 */
export type CanvasPostCheckPreview = {
    revision: number;
    product: CanvasCheckProduct;
    basis: CanvasCheckBasis;
    items: Array<CanvasCheckItem>;
    estimated_calls: number;
    reason?: (string | null);
};
