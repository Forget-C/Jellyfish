/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 用户维护的场次参考，空摘录表示全场。
 */
export type ShootingNote = {
    id: string;
    text: string;
    excerpt?: string;
    choice?: 'adopt' | 'delegate' | 'skip' | 'review';
    source?: 'user' | 'check';
};
