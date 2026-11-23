/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Freeze the attachment and relevant target state for atomic adoption.
 */
export type AdoptFirstFrameTarget = {
    kind: 'adopt_first_frame';
    file_id: string;
    file_name: string;
    reference_card_id: string;
    edge_id: string;
    basis: string;
    replaces_binding_id?: (string | null);
};
