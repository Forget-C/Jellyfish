/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GenerationSubmitRequest_Output } from './GenerationSubmitRequest_Output';
import type { InstructionInputs } from './InstructionInputs';
/**
 * 只读核验的实际执行输入；不创建任务，也不构成之后提交的通行凭据。
 */
export type SceneVideoPreparation = {
    version_id: string;
    unit_id: string;
    revision: number;
    check_task_id: string;
    inputs: InstructionInputs;
    request: GenerationSubmitRequest_Output;
};
