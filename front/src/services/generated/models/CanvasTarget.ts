/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasObject } from './CanvasObject';
/**
 * 显式定位业务对象；外部或历史目标必须携带独立来源上下文。
 */
export type CanvasTarget = {
    node_id: string;
    object: CanvasObject;
    field?: (string | null);
    external?: boolean;
};
