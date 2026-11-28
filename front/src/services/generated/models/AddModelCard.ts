/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Create a model card with an optional initial plain-text prompt.
 */
export type AddModelCard = {
    kind: 'add_model_card';
    modality: 'text' | 'image' | 'video';
    prompt?: string;
};
