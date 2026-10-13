/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 重新核实后的完整正文，来源指向真实任务；预览不改写原单元。
 */
export type SceneInstructionPreview = {
    unit_id: string;
    text: string;
    task_id: string;
    source: Source;
};
