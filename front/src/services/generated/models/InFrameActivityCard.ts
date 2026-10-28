/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
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
    task?: DesignField;
    attention?: DesignField;
    main_action_effect?: DesignField;
    path?: DesignField;
    delay_basis?: DesignField;
    delay_ms?: (number | null);
    entry_exit?: DesignField;
    exit_state?: DesignField;
    depth?: DesignField;
    intensity?: DesignField;
};

