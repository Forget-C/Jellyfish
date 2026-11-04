/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignFieldDocument } from './DesignFieldDocument';
/**
 * Design parameters with explicit, field-owned source references.
 */
export type ReferenceDesignField = {
    text?: string;
    state?: 'empty' | 'not_applicable' | 'absent' | 'undecided' | 'proposal' | 'fact';
    purpose?: 'background' | 'design' | 'constraint';
    source_locator?: string;
    document?: (DesignFieldDocument | null);
};
