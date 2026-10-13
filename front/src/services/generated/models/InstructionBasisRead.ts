/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InstructionInputs_Output } from './InstructionInputs_Output';
/**
 * 保留原依据以供差异核对；current 仅代表依据一致，不代表可生成。
 */
export type InstructionBasisRead = {
    basis_id: (string | null);
    status: 'empty' | 'unbound' | 'current' | 'changed';
    previous: (InstructionInputs_Output | null);
    current: InstructionInputs_Output;
};
