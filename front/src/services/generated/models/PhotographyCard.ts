/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
import type { PhotographyFields } from './PhotographyFields';
import type { PhotographyMediaExample } from './PhotographyMediaExample';
import type { PhotographyPhase } from './PhotographyPhase';
/**
 * 五个区域共同维护一张摄影设计；所属镜头不成为使用前置条件。
 */
export type PhotographyCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<PhotographyMediaExample>;
    type?: 'direction.photography';
    fields?: PhotographyFields;
    phases?: Array<PhotographyPhase>;
};
