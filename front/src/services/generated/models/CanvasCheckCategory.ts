/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 类别选择与当前依据适用性独立表达。
 */
export type CanvasCheckCategory = {
    id: string;
    label: string;
    enabled: boolean;
    availability: 'ready' | 'unavailable' | 'not_applicable';
    reason?: (string | null);
};
