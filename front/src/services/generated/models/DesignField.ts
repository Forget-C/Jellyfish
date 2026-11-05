/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 字段来源显式区分用户设定与提取；unknown 保持历史语义及快照格式。
 */
export type DesignField = {
    text?: string;
    state?: 'empty' | 'not_applicable' | 'absent' | 'undecided' | 'proposal' | 'fact';
    purpose?: 'background' | 'design' | 'constraint';
    source_locator?: string;
    /**
     * user 为用户明确设定，model 为模型提取，unknown 保留未标记历史数据。
     */
    authorship?: 'unknown' | 'user' | 'model';
    /**
     * 模型实际返回的元信息项；保存后保持缺项，不将契约默认值视为提取结果。
     */
    metadata_fields?: (Array<'state' | 'purpose' | 'source_locator'> | null);
};
