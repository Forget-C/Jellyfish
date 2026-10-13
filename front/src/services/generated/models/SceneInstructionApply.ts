/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 明确应用时返回正文、来源和不可变依据回执，供一次编辑共同采用。
 */
export type SceneInstructionApply = {
    unit_id: string;
    text: string;
    task_id: string;
    source: Source;
    basis_id: string;
};
