/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasNodeRead } from './CanvasNodeRead';
/**
 * 生命周期结束不代表整次运行的成功等级。
 */
export type CanvasRunRead = {
    id: string;
    canvas_id: string;
    lifecycle: 'active' | 'finished';
    nodes: Array<CanvasNodeRead>;
};
