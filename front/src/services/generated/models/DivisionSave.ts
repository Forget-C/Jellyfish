/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionDraft } from './DivisionDraft';
/**
 * 同 request_id 与同内容可安全重试；不同内容复用身份必须冲突。
 */
export type DivisionSave = {
    request_id: string;
    draft: DivisionDraft;
    preview_token: string;
    identity_changes_confirmed?: boolean;
};
