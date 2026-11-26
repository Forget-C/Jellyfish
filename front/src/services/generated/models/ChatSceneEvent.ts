/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ArtifactAnswer } from './ArtifactAnswer';
import type { ArtifactQuestion } from './ArtifactQuestion';
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { CanvasAssistantQueueItem } from './CanvasAssistantQueueItem';
export type ChatSceneEvent = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: string;
    payload: null;
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
    category: 'scene';
    detail: (CanvasAssistantExchange | CanvasAssistantQueueItem | ArtifactQuestion | ArtifactAnswer);
};
