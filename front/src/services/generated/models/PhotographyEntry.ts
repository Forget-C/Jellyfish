/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
/**
 * 输出中的字段状态和用途；仅被采用范围中的条目进入生成依据。
 */
export type PhotographyEntry = {
    id: string;
    label: string;
    region: 'composition' | 'camera' | 'movement' | 'lighting' | 'focus';
    value: DesignField;
};
