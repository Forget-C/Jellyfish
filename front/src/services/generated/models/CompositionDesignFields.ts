/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompositionFramingField } from './CompositionFramingField';
import type { DesignField } from './DesignField';
/**
 * 构图独立拥有所属字段，不包含其他摄影分区。
 */
export type CompositionDesignFields = {
    shot_size?: CompositionFramingField;
    composition?: DesignField;
    frame_position?: DesignField;
    depth_layers?: DesignField;
    negative_space?: DesignField;
    composition_requirements?: DesignField;
};
