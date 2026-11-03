/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DeliveredArtifactPublishState } from './DeliveredArtifactPublishState';
import type { GenerationModality } from './GenerationModality';
/**
 * 已归档产物的稳定交付视图，避免 API 消费 Provider 临时结果。
 */
export type DeliveredArtifact = {
    artifact_id: string;
    modality: GenerationModality;
    ordinal: number;
    file_id?: (string | null);
    text_content?: (string | null);
    publish_state: DeliveredArtifactPublishState;
    publish_error?: (string | null);
};
