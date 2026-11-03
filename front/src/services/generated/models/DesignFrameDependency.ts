/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 目标画面引用的固定来源事实；不是接收模型采用的媒体。
 */
export type DesignFrameDependency = {
    source: OutputIdentity;
    file_id?: (string | null);
    result_set_id?: (string | null);
    available: boolean;
    basis_current?: boolean;
};
