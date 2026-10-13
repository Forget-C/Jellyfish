/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TakeAnnotation_Output } from './TakeAnnotation_Output';
/**
 * 真实输出登记，审片与实际覆盖初始均为空，不包含自动采用语义。
 */
export type SceneTakeRead = {
    id: string;
    file_id: string;
    output_ordinal: number;
    annotation: TakeAnnotation_Output;
};
