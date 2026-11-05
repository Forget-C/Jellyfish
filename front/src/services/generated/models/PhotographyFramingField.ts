/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 仅已知景别结构可比较；自由文字不解释为硬要求。
 */
export type PhotographyFramingField = {
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
    size?: ('extreme_close_up' | 'close_up' | 'medium' | 'full' | 'wide' | 'extreme_wide' | null);
    target_id?: string;
    state_id?: (string | null);
};
