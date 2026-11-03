/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignFieldReference } from './DesignFieldReference';
import type { DesignFieldText } from './DesignFieldText';
/**
 * Editor-independent field segments with unique diagnostic identities.
 */
export type DesignFieldDocument = {
    segments?: Array<(DesignFieldText | DesignFieldReference)>;
};
