/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CoverageItem } from './CoverageItem';
import type { ModelCapability_Input } from './ModelCapability_Input';
import type { ReferenceBinding_Input } from './ReferenceBinding_Input';
import type { UnitDependency } from './UnitDependency';
/**
 * 一次明确模型请求的范围，可含多镜或部分动作。
 */
export type GenerationUnit_Input = {
    id: string;
    coverage: Array<CoverageItem>;
    references: Array<ReferenceBinding_Input>;
    model_id: string;
    duration_ms: number;
    ratio: string;
    parameters?: Record<string, (string | number | boolean | null)>;
    capability: ModelCapability_Input;
    dependencies?: Array<UnitDependency>;
};
