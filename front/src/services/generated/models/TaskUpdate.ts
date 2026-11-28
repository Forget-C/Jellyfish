/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ExperimentMessageRead } from './ExperimentMessageRead';
import type { MediaArtifactRead } from './MediaArtifactRead';
import type { MediaReferenceRead } from './MediaReferenceRead';
import type { TaskStatus } from './TaskStatus';
export type TaskUpdate = {
    task_id: string;
    model_id: (string | null);
    model_name: (string | null);
    parameters?: Record<string, any>;
    references?: Array<MediaReferenceRead>;
    artifacts?: Array<MediaArtifactRead>;
    status: TaskStatus;
    progress: (number | null);
    stage: string;
    error: string;
    cancel_requested: boolean;
    remote_cancellation: ('requested' | 'unsupported' | 'accepted' | 'confirmed' | 'rejected' | 'unconfirmed' | null);
    accepted_at_ms?: (number | null);
    finished_at_ms?: (number | null);
    execution_prompt?: (string | null);
    tool_call_id?: (string | null);
    messages?: (Array<ExperimentMessageRead> | null);
};
