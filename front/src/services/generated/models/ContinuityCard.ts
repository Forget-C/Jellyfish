/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConstraintMediaExample } from './ConstraintMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 可选主体及事件，前后态不会变成隐式首尾帧。
 */
export type ContinuityCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<ConstraintMediaExample>;
    type?: 'direction.continuity';
    category?: 'space' | 'appearance' | 'hands_props' | 'environment' | 'photography' | 'dialogue_sound';
    before?: ReferenceDesignField;
    change?: ReferenceDesignField;
    after?: ReferenceDesignField;
    following_constraints?: ReferenceDesignField;
};
