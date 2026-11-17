/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCardTypeDefinition } from './CanvasCardTypeDefinition';
import type { CanvasConnectionPolicy } from './CanvasConnectionPolicy';
/**
 * 当前画布归属允许的权威类型目录；不随画布编辑修订变化。
 */
export type CanvasCatalog = {
    version?: number;
    cards: Array<CanvasCardTypeDefinition>;
    connection_policies: Array<CanvasConnectionPolicy>;
};
