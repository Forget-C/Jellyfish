/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { FocusDesignFields } from './FocusDesignFields';
import type { InputBinding } from './InputBinding';
/**
 * Independent focus design, adopted only as a whole.
 */
export type FocusCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.focus';
    fields?: FocusDesignFields;
};
