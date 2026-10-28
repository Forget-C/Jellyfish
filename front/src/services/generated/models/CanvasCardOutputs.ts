/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasResolvedOutput } from './CanvasResolvedOutput';
/**
 * 已保存修订的本卡输出与直接候选；预览不改变采用。
 */
export type CanvasCardOutputs = {
    revision: number;
    card_id: string;
    outputs: Array<CanvasResolvedOutput>;
    candidates: Array<CanvasResolvedOutput>;
};
