/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddCanvasCardTarget } from './AddCanvasCardTarget';
import type { AdjustShotMovementTarget } from './AdjustShotMovementTarget';
import type { AdoptFirstFrameTarget } from './AdoptFirstFrameTarget';
import type { CardTextEdit } from './CardTextEdit';
import type { ConnectCardsTarget } from './ConnectCardsTarget';
import type { DeleteCardEdit } from './DeleteCardEdit';
import type { DesignTextFieldEdit } from './DesignTextFieldEdit';
import type { DisconnectCardsEdit } from './DisconnectCardsEdit';
import type { ModelPromptSegmentEdit } from './ModelPromptSegmentEdit';
import type { MovementFieldEdit } from './MovementFieldEdit';
import type { ReferenceNameEdit } from './ReferenceNameEdit';
import type { ReleaseBindingEdit } from './ReleaseBindingEdit';
import type { VideoDurationEdit } from './VideoDurationEdit';
import type { VideoInputTarget } from './VideoInputTarget';
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * Current field value which prevents a group from being applied.
 */
export type CanvasAssistantEditConflict = {
    group_id: string;
    card_id: string;
    target: (VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | ReferenceNameEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit | DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit | AddCanvasCardTarget | AdoptFirstFrameTarget | AdjustShotMovementTarget | ConnectCardsTarget | VideoInputTarget);
    current: (string | null);
};
