/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DeliveredArtifact } from './DeliveredArtifact';
import type { GenerationOutcome } from './GenerationOutcome';
/**
 * 终态交付的通用结果，供任务轮询与领域展示投影共享。
 */
export type GenerationDeliveryResult = {
    outcome: GenerationOutcome;
    artifacts?: Array<DeliveredArtifact>;
    primary_file_id?: (string | null);
    provider_task_id?: (string | null);
    error_code?: (string | null);
    error_message?: (string | null);
};

