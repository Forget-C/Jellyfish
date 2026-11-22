/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CapabilityDeclaration } from './CapabilityDeclaration';
/**
 * Model declarations stored apart from the parameters sent to providers.
 */
export type ModelCapabilityProfile = {
    text_inputs?: CapabilityDeclaration;
    image_inputs?: CapabilityDeclaration;
    video_inputs?: CapabilityDeclaration;
    audio_inputs?: CapabilityDeclaration;
    text_outputs?: CapabilityDeclaration;
    tool_calling?: CapabilityDeclaration;
    max_input_tokens?: (number | null);
};
