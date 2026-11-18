/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 最终顺序由列表位置决定；key 在草稿及响应丢失重试期间保持稳定。
 */
export type DivisionMember = {
    key: string;
    sequence_id?: (string | null);
    title: string;
    span: SourceSpan;
    reconfirm_source?: boolean;
};
