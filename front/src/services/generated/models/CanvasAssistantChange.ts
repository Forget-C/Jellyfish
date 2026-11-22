/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DeleteCardEdit } from './DeleteCardEdit';
import type { MovementFieldEdit } from './MovementFieldEdit';
import type { ReleaseBindingEdit } from './ReleaseBindingEdit';
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * Preview of one typed change associated with its originating turn.
 */
export type CanvasAssistantChange = {
    card_id: string;
    card_name: string;
    target: (VideoPromptSegmentEdit | MovementFieldEdit | DeleteCardEdit | ReleaseBindingEdit);
    before: string;
    after: string;
    impact_fingerprint?: (string | null);
};
