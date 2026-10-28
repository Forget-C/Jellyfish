/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActivityDesignFields } from './ActivityDesignFields';
import type { AnchorDesignFields } from './AnchorDesignFields';
import type { BlockingDesignFields } from './BlockingDesignFields';
import type { DesignScope } from './DesignScope';
import type { EnvironmentDesignFields } from './EnvironmentDesignFields';
import type { FrameState } from './FrameState';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { PerformanceDesignFields } from './PerformanceDesignFields';
import type { SpatialDesignRelations } from './SpatialDesignRelations';
import type { SpatialReferencePayload } from './SpatialReferencePayload';
/**
 * 本卡完整设计及直接采用的必要对象，不包含祖先正文或示例媒体。
 */
export type DesignTextPayload = {
    kind?: 'design';
    design_type: 'direction.situation' | 'direction.performance' | 'direction.performance_rule' | 'direction.anchor' | 'direction.blocking' | 'direction.activity' | 'direction.environment';
    adoption?: 'whole_card';
    text: string;
    frame_states?: Array<FrameState>;
    requires_frame_target?: boolean;
    fields: (PerformanceDesignFields | AnchorDesignFields | BlockingDesignFields | ActivityDesignFields | EnvironmentDesignFields);
    scope: DesignScope;
    objects?: Array<ObjectReferencePayload>;
    spatial_relations?: (SpatialDesignRelations | null);
    references?: Array<SpatialReferencePayload>;
    participant_id?: (string | null);
    source_locator?: string;
};
