/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { MovementDesignFields } from './MovementDesignFields';
import type { MovementPhase } from './MovementPhase';
/**
 * 独立运镜及稳定阶段，只有整卡设计出口。
 */
export type MovementCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.movement';
    fields?: MovementDesignFields;
    phases?: Array<MovementPhase>;
};
