/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 结构化不确定项：字段路径、原因及可选证据，便于人工审核与回溯。
 */
export type Uncertainty = {
    /**
     * 如 characters[0].name、scenes[2].location_id
     */
    field_path: string;
    /**
     * 不确定原因简述
     */
    reason: string;
    /**
     * 相关原文依据（可选）
     */
    evidence?: Array<EvidenceSpan>;
};

