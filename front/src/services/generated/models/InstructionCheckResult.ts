/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewRow } from './ReviewRow';
/**
 * 六岗逐覆盖项检查；结论不能授权生成或修改正文。
 */
export type InstructionCheckResult = {
    unit_id: string;
    rows: Array<ReviewRow>;
};
