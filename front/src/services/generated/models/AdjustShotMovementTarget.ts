/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Approval basis and identities for an edit limited to one shot.
 */
export type AdjustShotMovementTarget = {
    kind: 'adjust_shot_movement';
    movement_field: 'movement_type' | 'movement_start' | 'movement_trigger' | 'movement_path' | 'movement_speed' | 'end_frame';
    movement_card_id: string;
    binding_id: string;
    connection_id: string;
    basis: string;
    other_consumer_ids: Array<string>;
    copy_card_id?: (string | null);
};
