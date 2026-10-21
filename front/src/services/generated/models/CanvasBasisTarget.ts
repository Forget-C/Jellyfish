/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasTarget } from './CanvasTarget';
/**
 * 消费投影中的一行对应一个真实来源字段或明确不可定位的原因。
 */
export type CanvasBasisTarget = {
    section: 'execution' | 'constraints' | 'background';
    index: number;
    target?: (CanvasTarget | null);
    unavailable_reason?: (string | null);
};
