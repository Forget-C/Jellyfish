/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptDeliveryRowRead } from './PromptDeliveryRowRead';
/**
 * 出口 A 的清单与预览文本。
 */
export type PromptDeliveryRead = {
    project_id: string;
    /**
     * current_shot / episode / episodes
     */
    scope: string;
    scope_label: string;
    /**
     * 本次允许的提示词来源白名单
     */
    export_sources?: Array<string>;
    /**
     * 交付文本是否带出绑定资产
     */
    include_bindings?: boolean;
    /**
     * 本出口只认的来源值
     */
    export_source: string;
    exportable_count: number;
    skipped_count: number;
    /**
     * 交付文本是否非空
     */
    has_content: boolean;
    rows: Array<PromptDeliveryRowRead>;
    /**
     * 实际交付文本（可直接复制粘贴到其他平台）
     */
    text: string;
    /**
     * 口径与限制说明
     */
    note?: string;
};

