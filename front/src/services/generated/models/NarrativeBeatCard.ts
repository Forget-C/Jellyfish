/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
/**
 * beat 的专用字段及可选直接关系。
 */
export type NarrativeBeatCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    name?: string;
    type?: 'direction.beat';
    beat_id?: (string | null);
    objective?: DesignField;
    obstacle?: DesignField;
    expected_change?: DesignField;
    audience_must_see?: DesignField;
};
