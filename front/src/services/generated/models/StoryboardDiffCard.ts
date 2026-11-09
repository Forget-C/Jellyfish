/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * A card-level change or a preserved card with affected references.
 */
export type StoryboardDiffCard = {
    id: string;
    type: string;
    type_name: string;
    name: string;
    manually_edited?: boolean;
    lost_targets?: Array<string>;
};
