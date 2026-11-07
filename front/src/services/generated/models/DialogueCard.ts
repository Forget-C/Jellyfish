/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 一条稳定身份的对白，内容随画布修订保存。
 */
export type DialogueCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.dialogue';
    dialogue_id: string;
    content?: ReferenceDesignField;
    /**
     * 随对白采用的可选语言与发音设计要求。
     */
    language_pronunciation?: ReferenceDesignField;
};
