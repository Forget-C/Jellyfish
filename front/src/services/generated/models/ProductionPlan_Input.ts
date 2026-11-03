/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GenerationUnit_Input } from './GenerationUnit_Input';
/**
 * 冻结设计的生产分组，不在任务执行时隐式拆单元。
 */
export type ProductionPlan_Input = {
    design_revision_id: string;
    units: Array<GenerationUnit_Input>;
};
