/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignFieldDocument } from './DesignFieldDocument';
/**
 * Only the six visual designs expose reference-aware parameter documents.
 */
export type ReferenceDesignField = {
    text?: string;
    state?: 'empty' | 'not_applicable' | 'absent' | 'undecided' | 'proposal' | 'fact';
    purpose?: 'background' | 'design' | 'constraint';
    source_locator?: string;
    document?: (DesignFieldDocument | null);
};
