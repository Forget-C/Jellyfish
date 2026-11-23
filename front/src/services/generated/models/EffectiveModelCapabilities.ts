/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Capabilities available through one operation's current integration.
 */
export type EffectiveModelCapabilities = {
    text_inputs?: boolean;
    image_inputs?: boolean;
    video_inputs?: boolean;
    audio_inputs?: boolean;
    text_outputs?: boolean;
    tool_calling?: boolean;
    max_input_tokens?: (number | null);
};
