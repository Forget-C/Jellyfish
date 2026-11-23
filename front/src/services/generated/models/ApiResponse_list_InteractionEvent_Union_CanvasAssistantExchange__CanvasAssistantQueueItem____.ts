/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__ } from './InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__';
export type ApiResponse_list_InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem____ = {
    /**
     * 与 HTTP 状态码一致
     */
    code?: number;
    /**
     * 提示信息
     */
    message?: string;
    /**
     * 实际数据
     */
    data?: (Array<InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__> | null);
    /**
     * 附加元信息
     */
    meta?: (Record<string, any> | null);
};
