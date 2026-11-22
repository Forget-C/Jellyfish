/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantEditGroup } from './CanvasAssistantEditGroup';
import type { MovementFieldEdit } from './MovementFieldEdit';
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * A legacy single change or a set of independently selectable groups.
 */
export type CanvasAssistantProposal = {
    card_id: string;
    card_name: string;
    target: (VideoPromptSegmentEdit | MovementFieldEdit);
    before: string;
    after: string;
    state?: 'pending' | 'rejected' | 'applied' | 'superseded';
    groups?: (Array<CanvasAssistantEditGroup> | null);
};
