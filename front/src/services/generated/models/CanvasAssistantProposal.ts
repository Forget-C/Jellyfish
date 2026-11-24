/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddCanvasCardTarget } from './AddCanvasCardTarget';
import type { AdjustShotMovementTarget } from './AdjustShotMovementTarget';
import type { AdoptFirstFrameTarget } from './AdoptFirstFrameTarget';
import type { CanvasAssistantEditGroup } from './CanvasAssistantEditGroup';
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
import type { VideoPromptSegmentEdit } from './VideoPromptSegmentEdit';
/**
 * A legacy single change or a set of independently selectable groups.
 */
export type CanvasAssistantProposal = {
    card_id: string;
    card_name: string;
    target: (VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | ReferenceNameEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit | DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit | AddCanvasCardTarget | AdoptFirstFrameTarget | AdjustShotMovementTarget | ConnectCardsTarget);
    before: string;
    after: string;
    origin_reference?: (string | null);
    copy_of?: (string | null);
    impact_fingerprint?: (string | null);
    state?: 'pending' | 'rejected' | 'applied' | 'superseded';
    groups?: (Array<CanvasAssistantEditGroup> | null);
};
