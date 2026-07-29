/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一集的素材来源：新闻或原创设定的事实性上下文。
 *
 * 仅承载「事实/触发点」，不含创意执行；便于追溯与审核。
 */
export type NewsSource = {
    /**
     * 来源类型：news/original/fictional/generic
     */
    source_type: 'news' | 'original' | 'fictional' | 'generic';
    /**
     * 标题（新闻标题或原创触发点标题）
     */
    headline?: string;
    /**
     * 摘要：事件的中性概述
     */
    summary?: string;
    /**
     * 来源链接（可选；原创内容可为空）
     */
    source_url?: (string | null);
    /**
     * 发布时间（ISO-8601 字符串，可选）
     */
    published_at?: (string | null);
    /**
     * 事实性备注：不得改写为投资建议或价格预测
     */
    factual_notes?: string;
};

