/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Safe historical verification metadata without upstream credentials or content.
 */
export type ModelCapabilityVerificationRead = {
    id: string;
    provider_id: string;
    provider_name: string;
    model_name: string;
    endpoint: string;
    capability: 'tool_calling' | 'image_inputs' | 'video_inputs' | 'audio_inputs';
    outcome: 'passed' | 'failed';
    reason: 'verified' | 'tool_not_called' | 'tool_result_not_used' | 'expected_observation_missing' | 'provider_unavailable' | 'request_failed' | 'probe_unavailable';
    tested_at: string;
    current: boolean;
};
