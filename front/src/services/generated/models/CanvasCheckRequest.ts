/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 检查当前显示的依据；单项执行必须明确指定其身份。
 */
export type CanvasCheckRequest = {
    expected_revision: number;
    basis_hash: string;
    item_id?: (string | null);
};
