/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraShot_Output } from './CameraShot_Output';
import type { ContinuityState_Output } from './ContinuityState_Output';
import type { Criterion_Output } from './Criterion_Output';
import type { Direction_Output } from './Direction_Output';
import type { Event_Output } from './Event_Output';
import type { Participant } from './Participant';
import type { Performance_Output } from './Performance_Output';
import type { PromptDirection_Output } from './PromptDirection_Output';
import type { SoundDesign_Output } from './SoundDesign_Output';
import type { Source } from './Source';
import type { Staging_Output } from './Staging_Output';
/**
 * 一份完整六岗设计内容，局部身份仅在此版本内解析。
 */
export type SceneDesign_Output = {
    sources: Array<Source>;
    style_revision_id?: (string | null);
    participants: Array<Participant>;
    events: Array<Event_Output>;
    criteria: Array<Criterion_Output>;
    direction: Direction_Output;
    performance: Performance_Output;
    staging: Staging_Output;
    cinematography: Array<CameraShot_Output>;
    continuity: Array<ContinuityState_Output>;
    sound: SoundDesign_Output;
    prompt: PromptDirection_Output;
};
