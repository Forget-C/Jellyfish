/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaOutputPayload } from './MediaOutputPayload';
import type { NamedImagePayload } from './NamedImagePayload';
import type { OutputIdentity } from './OutputIdentity';
/**
 * Actual active field media, with stable provenance and resolved availability.
 */
export type DesignMediaReference = {
    source: OutputIdentity;
    field_id: string;
    modality: 'image' | 'video' | 'audio';
    token: string;
    file_id?: (string | null);
    result_set_id?: (string | null);
    available: boolean;
    basis_current?: boolean;
    payload?: (MediaOutputPayload | NamedImagePayload | null);
};
