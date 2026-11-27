/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageModeDeclaration } from './ImageModeDeclaration';
import type { VideoModeDeclaration } from './VideoModeDeclaration';
/**
 * Model declarations stored apart from the parameters sent to providers.
 */
export type ModelCapabilityProfile_Input = {
    text_inputs?: boolean;
    image_inputs?: boolean;
    video_inputs?: boolean;
    audio_inputs?: boolean;
    text_outputs?: boolean;
    tool_calling?: boolean;
    image_outputs?: boolean;
    video_outputs?: boolean;
    audio_outputs?: boolean;
    non_streaming?: boolean;
    native_streaming?: boolean;
    tool_results?: boolean;
    parallel_tool_calls?: boolean;
    streaming_tool_arguments?: boolean;
    json_object?: boolean;
    json_schema?: boolean;
    direct_result?: boolean;
    remote_task?: boolean;
    remote_cancel?: boolean;
    context_window?: (number | null);
    max_input_tokens?: (number | null);
    max_output_tokens?: (number | null);
    image_modes?: Record<string, ImageModeDeclaration>;
    video_modes?: Record<string, VideoModeDeclaration>;
};
