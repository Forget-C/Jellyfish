/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompositionDesignFields } from './CompositionDesignFields';
import type { DesignFrameTarget } from './DesignFrameTarget';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
/**
 * 独立景别与构图，仅整卡采用。
 */
export type CompositionCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.composition';
    fields?: CompositionDesignFields;
    frame_target?: (DesignFrameTarget | null);
};
