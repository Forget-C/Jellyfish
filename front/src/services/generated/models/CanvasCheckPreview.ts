/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckBasis } from './CanvasCheckBasis';
import type { CanvasCheckItem } from './CanvasCheckItem';
/**
 * 连接后列项，用户显式发起执行。
 */
export type CanvasCheckPreview = {
    basis?: (CanvasCheckBasis | null);
    items?: Array<CanvasCheckItem>;
    reason?: (string | null);
};
