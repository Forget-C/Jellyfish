/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * An active field problem follows adopted design output to model diagnostics.
 */
export type DesignReferenceIssue = {
    source: OutputIdentity;
    field_id: string;
    reference_id: string;
    code: string;
    message: string;
};
