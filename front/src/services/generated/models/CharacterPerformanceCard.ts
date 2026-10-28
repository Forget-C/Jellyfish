/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
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
    objective?: DesignField;
    obstacle?: DesignField;
    subtext?: DesignField;
    attention?: DesignField;
    internal_adjustment?: DesignField;
    physical_action?: DesignField;
    gaze?: DesignField;
    breath?: DesignField;
    weight?: DesignField;
    hands?: DesignField;
    voice?: DesignField;
    delivery?: DesignField;
    reaction_order?: DesignField;
    exit_state?: DesignField;
    avoid?: DesignField;
};
