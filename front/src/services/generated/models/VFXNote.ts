/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 单条视效说明：类型、描述、复杂度及原文依据。
 */
export type VFXNote = {
    vfx_type?: 'NONE' | 'PARTICLES' | 'VOLUMETRIC_FOG' | 'CG_DOUBLE' | 'DIGITAL_ENVIRONMENT' | 'MATTE_PAINTING' | 'FIRE_SMOKE' | 'WATER_SIM' | 'DESTRUCTION' | 'ENERGY_MAGIC' | 'COMPOSITING_CLEANUP' | 'SLOW_MOTION_TIME' | 'OTHER';
    /**
     * 视效说明（简短、可执行）
     */
    description?: (string | null);
    /**
     * 粗略复杂度
     */
    complexity?: ('LOW' | 'MEDIUM' | 'HIGH' | null);
    /**
     * 原文依据（若为忠实抽取）
     */
    evidence?: Array<EvidenceSpan>;
};

