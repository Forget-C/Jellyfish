/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 产物视图。
 */
export type ProductionArtifactView = {
    id: string;
    production_shot_id: (string | null);
    artifact_type: string;
    stage: string;
    provider: string;
    provider_model: string;
    file_path: string;
    mime_type: string;
    checksum: string;
};

