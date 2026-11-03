/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 固定投影中一项视频要求在最终正文或实际参考中的去向。
 */
export type InstructionDestination = {
    owner: string;
    field: string;
    coverage_item_ids: Array<string>;
    destination: 'instruction' | 'reference' | 'unresolved';
    instruction_excerpt?: (string | null);
    reference_id?: (string | null);
    rationale: string;
};

