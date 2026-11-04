/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 明确调度对象供后续镜头引用；事件来源后续接入。
 */
export type BlockingDirectionCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.blocking';
    blocking_id?: (string | null);
    name?: string;
    position?: ReferenceDesignField;
    orientation?: ReferenceDesignField;
    initiative?: ReferenceDesignField;
    path?: ReferenceDesignField;
    transition_reason?: ReferenceDesignField;
};
