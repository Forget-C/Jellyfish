/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AnchorImageMarker } from './AnchorImageMarker';
import type { DesignField } from './DesignField';
import type { DesignMediaExample } from './DesignMediaExample';
import type { DesignScope } from './DesignScope';
import type { InputBinding } from './InputBinding';
/**
 * 文字可先于参考图；锚点身份不随媒体更换。
 */
export type SpatialAnchorCard = {
    id: string;
    type_version?: number;
    scope?: DesignScope;
    source_locator?: string;
    input_bindings?: Array<InputBinding>;
    examples?: Array<DesignMediaExample>;
    type?: 'direction.anchor';
    anchor_id?: (string | null);
    markers?: Array<AnchorImageMarker>;
    name?: string;
    position?: DesignField;
    orientation?: DesignField;
    spatial_relation?: DesignField;
    scale?: DesignField;
};
