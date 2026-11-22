/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddCanvasCardTarget } from './AddCanvasCardTarget';
import type { AdoptFirstFrameTarget } from './AdoptFirstFrameTarget';
import type { CanvasAssistantEditGroup } from './CanvasAssistantEditGroup';
import type { DeleteCardEdit } from './DeleteCardEdit';
import type { MovementFieldEdit } from './MovementFieldEdit';
import type { ReleaseBindingEdit } from './ReleaseBindingEdit';
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * A legacy single change or a set of independently selectable groups.
 */
export type CanvasAssistantProposal = {
    card_id: string;
    card_name: string;
    target: (VideoPromptSegmentEdit | MovementFieldEdit | DeleteCardEdit | ReleaseBindingEdit | AddCanvasCardTarget | AdoptFirstFrameTarget);
    before: string;
    after: string;
    impact_fingerprint?: (string | null);
    state?: 'pending' | 'rejected' | 'applied' | 'superseded';
    groups?: (Array<CanvasAssistantEditGroup> | null);
};
