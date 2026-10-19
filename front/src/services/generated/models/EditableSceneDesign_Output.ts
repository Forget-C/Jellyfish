/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CameraShot_Output } from './CameraShot_Output';
import type { ContinuityState_Output } from './ContinuityState_Output';
import type { Criterion_Output } from './Criterion_Output';
import type { DesignApplicability } from './DesignApplicability';
import type { EditableDirection_Output } from './EditableDirection_Output';
import type { Event_Output } from './Event_Output';
import type { Participant } from './Participant';
import type { Performance_Output } from './Performance_Output';
import type { PromptDirection_Output } from './PromptDirection_Output';
import type { SoundDesign_Output } from './SoundDesign_Output';
import type { Source } from './Source';
import type { Staging_Output } from './Staging_Output';
/**
 * 空工作单表达未填信息，不为保存构造虚假的镜头或业务完成状态。
 */
export type EditableSceneDesign_Output = {
    sources: Array<Source>;
    style_revision_id: (string | null);
    participants: Array<Participant>;
    events: Array<Event_Output>;
    criteria: Array<Criterion_Output>;
    direction: EditableDirection_Output;
    performance: Performance_Output;
    staging: Staging_Output;
    cinematography: Array<CameraShot_Output>;
    continuity: Array<ContinuityState_Output>;
    sound: SoundDesign_Output;
    prompt: PromptDirection_Output;
    applicability: Array<DesignApplicability>;
};
