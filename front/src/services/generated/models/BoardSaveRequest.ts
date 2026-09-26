/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BoardEntryWrite } from './BoardEntryWrite';
/**
 * 确认后批量保存请求。
 */
export type BoardSaveRequest = {
    entries?: Array<BoardEntryWrite>;
    mode?: 'fill_empty' | 'overwrite_selected';
    /**
     * 本批内容的**流程来源**（由流程决定，服务端映射成真实 source）
     */
    origin: 'llm_draft' | 'jurilu_import' | 'external_import' | 'manual';
    /**
     * 「只覆盖选中镜头」模式下的选中集合；空表示当前集内全选
     */
    selected_shot_ids?: Array<string>;
    /**
     * 是否允许「仅保存已匹配项」。默认 false = 提交条数与本集镜头数不一致时拒绝整体保存；用户在预览页显式切换为「仅保存已匹配项」后前端才传 true。
     */
    allow_partial?: boolean;
    /**
     * 巨日禄脚本组 ID（**单数**；origin=jurilu_import 时必填）
     */
    script_id?: string;
    /**
     * 已废弃的复数写法：传它一律 400，请改用单数 script_id
     */
    script_ids?: any;
};

