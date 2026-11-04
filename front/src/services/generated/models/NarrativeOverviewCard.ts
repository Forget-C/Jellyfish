/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * narrative 的专用字段及可选直接关系。
 */
export type NarrativeOverviewCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    name?: string;
    type?: 'direction.narrative';
    viewpoint?: ReferenceDesignField;
    information_change?: ReferenceDesignField;
    relationship_change?: ReferenceDesignField;
    turning_point?: ReferenceDesignField;
    open_questions?: ReferenceDesignField;
};

