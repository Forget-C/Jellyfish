/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
/**
 * 声源、环境声、动作声和音乐约束保持各自用途及制作安排。
 */
export type SoundArrangementCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.sound';
    source_description?: DesignField;
    environment?: DesignField;
    action_sound?: DesignField;
    music?: DesignField;
    production?: 'synchronous' | 'postproduction' | 'undecided';
};
