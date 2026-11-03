/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraShot_Input } from './CameraShot_Input';
import type { ContinuityState_Input } from './ContinuityState_Input';
import type { Criterion_Input } from './Criterion_Input';
import type { Direction_Input } from './Direction_Input';
import type { Event_Input } from './Event_Input';
import type { Participant } from './Participant';
import type { Performance_Input } from './Performance_Input';
import type { PromptDirection_Input } from './PromptDirection_Input';
import type { SoundDesign_Input } from './SoundDesign_Input';
import type { Source } from './Source';
import type { Staging_Input } from './Staging_Input';
/**
 * 一份完整六岗设计内容，局部身份仅在此版本内解析。
 */
export type SceneDesign_Input = {
    sources: Array<Source>;
    style_revision_id?: (string | null);
    participants: Array<Participant>;
    events: Array<Event_Input>;
    criteria: Array<Criterion_Input>;
    direction: Direction_Input;
    performance: Performance_Input;
    staging: Staging_Input;
    cinematography: Array<CameraShot_Input>;
    continuity: Array<ContinuityState_Input>;
    sound: SoundDesign_Input;
    prompt: PromptDirection_Input;
};
