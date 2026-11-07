/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 模型候选范围。only 指定位置，except 保留新增位置的候选资格。
 */
export type CanvasResultScope = {
    mode: 'only' | 'except';
    positions: Array<number>;
};
