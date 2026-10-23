/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 已发布的实际输出，运行层可注入模型当前输出而无需虚构未来结果。
 */
export type CanvasResolvedOutput = {
    source: OutputIdentity;
    modality: string;
    text?: (string | null);
    file_id?: (string | null);
    token?: string;
    available?: boolean;
    basis_current?: boolean;
    result_set_id?: (string | null);
};
