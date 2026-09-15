/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CutFrameRead } from './CutFrameRead';
import type { SeamRead } from './SeamRead';
import type { UnitContinuityRead } from './UnitContinuityRead';
/**
 * 当前已确认采用依据、实际边界帧、接缝与受影响单元。
 */
export type ContinuityRead = {
    active_cut_revision_id: (string | null);
    frames: Array<CutFrameRead>;
    seams: Array<SeamRead>;
    units: Array<UnitContinuityRead>;
};
