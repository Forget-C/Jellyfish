/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EditableCoverageItem_Output } from './EditableCoverageItem_Output';
/**
 * 仅允许组织字段；参考要求与衔接描述均不构成真实文件或落幅绑定。
 */
export type SceneUnitDesignProposal = {
    id: string;
    coverage: Array<EditableCoverageItem_Output>;
    duration_ms?: (number | null);
    ratio: string;
    reason: string;
    entry_state?: string;
    exit_state?: string;
    reference_requirements?: Array<string>;
    missing?: Array<string>;
};
