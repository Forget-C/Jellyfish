/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShootingScope } from './ShootingScope';
/**
 * 拍摄参考，适用范围独立于引用依据。
 */
export type ShootingNote = {
    id: string;
    text: string;
    excerpt?: string;
    scope?: (ShootingScope | null);
    previous_scope_text?: string;
    choice?: 'adopt' | 'delegate' | 'skip' | 'review';
    source?: 'user' | 'check';
};
