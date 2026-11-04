/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 控制发挥范围，不建立全场自动适用规则。
 */
export type CreativeControlCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    name?: string;
    type?: 'direction.creative_control';
    freedom?: ReferenceDesignField;
    allowed_range?: ReferenceDesignField;
    keep?: ReferenceDesignField;
    undecided?: ReferenceDesignField;
};
