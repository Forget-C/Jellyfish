/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraShot_Input } from './CameraShot_Input';
import type { ContinuityState_Input } from './ContinuityState_Input';
import type { Criterion_Input } from './Criterion_Input';
import type { EditableDirection_Input } from './EditableDirection_Input';
import type { Event_Input } from './Event_Input';
import type { Participant } from './Participant';
import type { Performance_Input } from './Performance_Input';
import type { PromptDirection_Input } from './PromptDirection_Input';
import type { SoundDesign_Input } from './SoundDesign_Input';
import type { Source } from './Source';
import type { Staging_Input } from './Staging_Input';
/**
 * 空工作单表达未填信息，不为保存构造虚假的镜头或业务完成状态。
 */
export type EditableSceneDesign_Input = {
    sources: Array<Source>;
    style_revision_id?: (string | null);
    participants?: Array<Participant>;
    events?: Array<Event_Input>;
    criteria?: Array<Criterion_Input>;
    direction?: EditableDirection_Input;
    performance?: Performance_Input;
    staging?: Staging_Input;
    cinematography?: Array<CameraShot_Input>;
    continuity?: Array<ContinuityState_Input>;
    sound?: SoundDesign_Input;
    prompt?: PromptDirection_Input;
};
