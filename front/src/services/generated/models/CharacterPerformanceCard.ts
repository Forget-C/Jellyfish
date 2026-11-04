/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 完整表演；可选后续端点待对应来源票据接入，不伪造身份。
 */
export type CharacterPerformanceCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.performance';
    objective?: ReferenceDesignField;
    obstacle?: ReferenceDesignField;
    subtext?: ReferenceDesignField;
    attention?: ReferenceDesignField;
    internal_adjustment?: ReferenceDesignField;
    physical_action?: ReferenceDesignField;
    gaze?: ReferenceDesignField;
    breath?: ReferenceDesignField;
    weight?: ReferenceDesignField;
    hands?: ReferenceDesignField;
    voice?: ReferenceDesignField;
    delivery?: ReferenceDesignField;
    reaction_order?: ReferenceDesignField;
    exit_state?: ReferenceDesignField;
    avoid?: ReferenceDesignField;
};
