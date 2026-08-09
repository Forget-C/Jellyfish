/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 市场数据锁定状态。
 */
export type DataLock = {
    /**
     * 锁定状态
     */
    status?: 'unresolved' | 'locked';
    /**
     * 锁定时间（ISO-8601）
     */
    locked_at_utc?: (string | null);
};

