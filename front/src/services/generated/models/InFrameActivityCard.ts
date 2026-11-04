/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 持续任务、反应延迟与入出画；触发事件不自动执行。
 */
export type InFrameActivityCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.activity';
    task?: ReferenceDesignField;
    attention?: ReferenceDesignField;
    main_action_effect?: ReferenceDesignField;
    path?: ReferenceDesignField;
    delay_basis?: ReferenceDesignField;
    delay_ms?: (number | null);
    entry_exit?: ReferenceDesignField;
    exit_state?: ReferenceDesignField;
    depth?: ReferenceDesignField;
    intensity?: ReferenceDesignField;
};
