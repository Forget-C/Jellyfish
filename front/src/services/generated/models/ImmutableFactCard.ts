/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConstraintMediaExample } from './ConstraintMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 保留事实、来源与范围，不验证文本或图片真伪。
 */
export type ImmutableFactCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<ConstraintMediaExample>;
    type?: 'direction.fact';
    fact?: ReferenceDesignField;
    source_basis?: ReferenceDesignField;
};
