/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * A field owns its stable source, independently of model adoption bindings.
 */
export type DesignFieldReference = {
    id: string;
    kind: 'reference';
    source: OutputIdentity;
};
