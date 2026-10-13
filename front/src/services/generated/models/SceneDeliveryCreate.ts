/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 先保存再交付指定修订，原请求核实不重新激活历史交付。
 */
export type SceneDeliveryCreate = {
    request_id: string;
    expected_revision: number;
};
