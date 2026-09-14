/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CoverageItem } from './CoverageItem';
import type { ModelCapability_Output } from './ModelCapability_Output';
import type { ReferenceBinding_Output } from './ReferenceBinding_Output';
/**
 * 一次明确模型请求的范围，可含多镜或部分动作。
 */
export type GenerationUnit_Output = {
    id: string;
    coverage: Array<CoverageItem>;
    references: Array<ReferenceBinding_Output>;
    model_id: string;
    duration_ms: number;
    ratio: string;
    parameters?: Record<string, (string | number | boolean | null)>;
    capability: ModelCapability_Output;
    depends_on_unit_ids?: Array<string>;
};

