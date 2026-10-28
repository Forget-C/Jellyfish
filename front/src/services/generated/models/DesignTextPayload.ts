/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignScope } from './DesignScope';
import type { DialogueBasis } from './DialogueBasis';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { PerformanceDesignFields } from './PerformanceDesignFields';
import type { SoundDesignFields } from './SoundDesignFields';
/**
 * 本卡完整设计及直接采用的必要对象，不包含祖先正文或示例媒体。
 */
export type DesignTextPayload = {
    kind?: 'design';
    design_type: 'direction.situation' | 'direction.performance' | 'direction.performance_rule' | 'direction.dialogue' | 'direction.sound';
    adoption?: 'whole_card';
    text: string;
    fields: (PerformanceDesignFields | SoundDesignFields);
    scope: DesignScope;
    objects?: Array<ObjectReferencePayload>;
    participant_id?: (string | null);
    dialogue_id?: (string | null);
    version?: (number | null);
    source_locator?: string;
    dialogue_basis?: Array<DialogueBasis>;
};
