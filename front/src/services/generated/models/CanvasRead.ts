/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDocument } from './CanvasDocument';
/**
 * 当前保存的内容和 CAS 修订。
 */
export type CanvasRead = {
    id: string;
    project_id: string;
    revision: number;
    document: CanvasDocument;
    source_changed?: (boolean | null);
};
