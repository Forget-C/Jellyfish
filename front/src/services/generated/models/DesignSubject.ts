/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 用原对象 ID 与稳定字段名定位一项设计，不依赖数组顺序。
 */
export type DesignSubject = {
    kind: 'direction' | 'beat' | 'shot' | 'criterion' | 'event' | 'performance_beat' | 'staging_activity' | 'camera' | 'continuity' | 'immutable_fact' | 'prompt' | 'sound';
    id?: (string | null);
    field: string;
};
