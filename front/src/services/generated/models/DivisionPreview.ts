/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionImpact } from './DivisionImpact';
/**
 * 预览依据绑定完整草稿及实时影响；阻塞存在时不能保存。
 */
export type DivisionPreview = {
    preview_token: string;
    impacts: Array<DivisionImpact>;
    blockers: Array<string>;
    unassigned_character_count: number;
    identity_confirmation_required: boolean;
};
