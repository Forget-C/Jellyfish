/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Require acknowledgement of the call estimate for the selected product.
 */
export type CanvasPostCheckRequest = {
    expected_revision: number;
    basis_hash: string;
    item_id?: (string | null);
    expected_calls: number;
};
