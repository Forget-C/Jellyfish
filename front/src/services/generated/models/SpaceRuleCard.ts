/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConstraintMediaExample } from './ConstraintMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 空间规则可独立使用，所属空间只提供身份和名称。
 */
export type SpaceRuleCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<ConstraintMediaExample>;
    type?: 'direction.space_rule';
    spatial_basis?: ReferenceDesignField;
    shootable_area?: ReferenceDesignField;
    axis?: ReferenceDesignField;
    scale?: ReferenceDesignField;
};
