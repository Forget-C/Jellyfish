/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NarrativeReferencePayload } from './NarrativeReferencePayload';
import type { ObjectReferencePayload } from './ObjectReferencePayload';
import type { SpatialReferencePayload } from './SpatialReferencePayload';
/**
 * 直接采用的用途与必要身份，保留多个不同用途。
 */
export type NarrativeDesignRelation = {
    input_port: 'participant' | 'effect_object' | 'covered_beat' | 'related_event' | 'blocking_basis' | 'beat' | 'received_event' | 'change_event' | 'trigger_event' | 'shot' | 'space' | 'position_anchor' | 'area_anchor';
    reference: (ObjectReferencePayload | SpatialReferencePayload | NarrativeReferencePayload);
};
