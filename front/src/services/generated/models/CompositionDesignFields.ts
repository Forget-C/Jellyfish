/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompositionFramingField } from './CompositionFramingField';
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 构图独立拥有所属字段，不包含其他摄影分区。
 */
export type CompositionDesignFields = {
    shot_size?: CompositionFramingField;
    composition?: ReferenceDesignField;
    frame_position?: ReferenceDesignField;
    depth_layers?: ReferenceDesignField;
    negative_space?: ReferenceDesignField;
    composition_requirements?: ReferenceDesignField;
};
