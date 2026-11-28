/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ArtifactQuestion } from './ArtifactQuestion';
import type { ExperimentMessageRead } from './ExperimentMessageRead';
import type { LabModels } from './LabModels';
export type LabChatSnapshot = {
    session_id: string;
    cursor: number;
    capabilities: Array<string>;
    active_turn: (string | null);
    models: LabModels;
    messages: Array<ExperimentMessageRead>;
    partial_reply?: string;
    question?: (ArtifactQuestion | null);
};
