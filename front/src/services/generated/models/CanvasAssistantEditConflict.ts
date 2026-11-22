/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddCanvasCardTarget } from './AddCanvasCardTarget';
import type { AdoptFirstFrameTarget } from './AdoptFirstFrameTarget';
import type { MovementFieldEdit } from './MovementFieldEdit';
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * Current field value which prevents a group from being applied.
 */
export type CanvasAssistantEditConflict = {
    group_id: string;
    card_id: string;
    target: (VideoPromptSegmentEdit | MovementFieldEdit | AddCanvasCardTarget | AdoptFirstFrameTarget);
    current: (string | null);
};
