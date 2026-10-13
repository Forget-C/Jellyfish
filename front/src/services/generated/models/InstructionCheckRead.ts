/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InstructionCheckResult } from './InstructionCheckResult';
import type { InstructionInputs_Output } from './InstructionInputs_Output';
/**
 * 固定历史记录；成功结果仍须用户查看和核对适用性。
 */
export type InstructionCheckRead = {
    task_id: string;
    origin_version_id: string;
    request_id: string;
    status: string;
    error: (string | null);
    instruction: string;
    inputs: InstructionInputs_Output;
    model_name: string;
    result: (InstructionCheckResult | null);
};
