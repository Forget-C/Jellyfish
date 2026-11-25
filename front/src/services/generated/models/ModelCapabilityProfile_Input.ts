/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CapabilityDeclaration } from './CapabilityDeclaration';
import type { ImageModeDeclaration } from './ImageModeDeclaration';
import type { VideoModeDeclaration } from './VideoModeDeclaration';
/**
 * Model declarations stored apart from the parameters sent to providers.
 */
export type ModelCapabilityProfile_Input = {
    text_inputs?: CapabilityDeclaration;
    image_inputs?: CapabilityDeclaration;
    video_inputs?: CapabilityDeclaration;
    audio_inputs?: CapabilityDeclaration;
    text_outputs?: CapabilityDeclaration;
    tool_calling?: CapabilityDeclaration;
    image_outputs?: CapabilityDeclaration;
    video_outputs?: CapabilityDeclaration;
    audio_outputs?: CapabilityDeclaration;
    non_streaming?: CapabilityDeclaration;
    native_streaming?: CapabilityDeclaration;
    tool_results?: CapabilityDeclaration;
    parallel_tool_calls?: CapabilityDeclaration;
    streaming_tool_arguments?: CapabilityDeclaration;
    json_object?: CapabilityDeclaration;
    json_schema?: CapabilityDeclaration;
    direct_result?: CapabilityDeclaration;
    remote_task?: CapabilityDeclaration;
    remote_cancel?: CapabilityDeclaration;
    max_input_tokens?: (number | null);
    max_output_tokens?: (number | null);
    image_modes?: Record<string, ImageModeDeclaration>;
    video_modes?: Record<string, VideoModeDeclaration>;
};
