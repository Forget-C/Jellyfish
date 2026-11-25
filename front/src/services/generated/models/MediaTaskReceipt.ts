/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaArtifactRead } from './MediaArtifactRead';
import type { MediaReferenceRead } from './MediaReferenceRead';
import type { TaskStatus } from './TaskStatus';
/**
 * Allowlisted execution evidence; private provider configuration stays server-side.
 */
export type MediaTaskReceipt = {
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
};
