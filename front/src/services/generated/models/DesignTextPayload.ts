/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AcceptanceCriterionFields } from './AcceptanceCriterionFields';
import type { ActivityDesignFields } from './ActivityDesignFields';
import type { AnchorDesignFields } from './AnchorDesignFields';
import type { BlockingDesignFields } from './BlockingDesignFields';
import type { CompositionDesignFields } from './CompositionDesignFields';
import type { ContinuityFields } from './ContinuityFields';
import type { CreativeControlFields } from './CreativeControlFields';
import type { CriterionReferencePayload } from './CriterionReferencePayload';
import type { DesignScope } from './DesignScope';
import type { DialogueBasis } from './DialogueBasis';
import type { EnvironmentDesignFields } from './EnvironmentDesignFields';
import type { FrameState } from './FrameState';
import type { GenerationGuidanceFields } from './GenerationGuidanceFields';
import type { ImmutableFactFields } from './ImmutableFactFields';
import type { MovementDesignFields } from './MovementDesignFields';
import type { MovementPhase } from './MovementPhase';
import type { NarrativeBeatFields } from './NarrativeBeatFields';
import type { NarrativeDesignRelation } from './NarrativeDesignRelation';
import type { NarrativeEventFields } from './NarrativeEventFields';
import type { NarrativeOverviewFields } from './NarrativeOverviewFields';
import type { NarrativeReferencePayload } from './NarrativeReferencePayload';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { PerformanceDesignFields } from './PerformanceDesignFields';
import type { ShotDesignFields } from './ShotDesignFields';
import type { SoundDesignFields } from './SoundDesignFields';
import type { SpaceRuleFields } from './SpaceRuleFields';
import type { SpatialDesignRelations } from './SpatialDesignRelations';
import type { SpatialReferencePayload } from './SpatialReferencePayload';
import type { StyleDesignFields } from './StyleDesignFields';
/**
 * 本卡完整设计及直接采用的必要对象，不包含祖先正文或示例媒体。
 */
export type DesignTextPayload = {
    kind?: 'design';
    design_type: 'direction.movement' | 'direction.composition' | 'direction.style' | 'direction.space_rule' | 'direction.continuity' | 'direction.fact' | 'direction.creative_control' | 'direction.guidance' | 'direction.criterion' | 'direction.situation' | 'direction.performance' | 'direction.performance_rule' | 'direction.anchor' | 'direction.blocking' | 'direction.activity' | 'direction.environment' | 'direction.narrative' | 'direction.beat' | 'direction.event' | 'direction.shot' | 'direction.dialogue' | 'direction.sound';
    adoption?: 'whole_card';
    text: string;
    movement_phases?: Array<MovementPhase>;
    frame_states?: Array<FrameState>;
    requires_frame_target?: boolean;
    fields: (MovementDesignFields | CompositionDesignFields | StyleDesignFields | SpaceRuleFields | ContinuityFields | ImmutableFactFields | CreativeControlFields | GenerationGuidanceFields | AcceptanceCriterionFields | NarrativeOverviewFields | NarrativeBeatFields | NarrativeEventFields | ShotDesignFields | PerformanceDesignFields | AnchorDesignFields | BlockingDesignFields | ActivityDesignFields | EnvironmentDesignFields | SoundDesignFields);
    scope: DesignScope;
    objects?: Array<ObjectReferencePayload>;
    spatial_relations?: (SpatialDesignRelations | null);
    references?: Array<(SpatialReferencePayload | NarrativeReferencePayload)>;
    narrative_relations?: Array<NarrativeDesignRelation>;
    participant_id?: (string | null);
    dialogue_id?: (string | null);
    version?: (number | null);
    source_locator?: string;
    acceptance_basis?: Array<CriterionReferencePayload>;
    dialogue_basis?: Array<DialogueBasis>;
};
