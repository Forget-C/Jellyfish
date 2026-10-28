/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
/**
 * 编译要求是创作者表达，参考需求不替代明确输入绑定。
 */
export type GenerationGuidanceCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    name?: string;
    type?: 'direction.guidance';
    priority?: DesignField;
    reference_requirements?: DesignField;
    sound_strategy?: DesignField;
    prohibitions?: DesignField;
};
