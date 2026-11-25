/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasAssistantExchange_ } from '../models/ApiResponse_CanvasAssistantExchange_';
import type { ApiResponse_CanvasAssistantHistory_ } from '../models/ApiResponse_CanvasAssistantHistory_';
import type { ApiResponse_LabChatSnapshot_ } from '../models/ApiResponse_LabChatSnapshot_';
import type { ApiResponse_LabModels_ } from '../models/ApiResponse_LabModels_';
import type { ApiResponse_list_ExperimentMessageRead__ } from '../models/ApiResponse_list_ExperimentMessageRead__';
import type { ApiResponse_TextLabRunStatus_ } from '../models/ApiResponse_TextLabRunStatus_';
import type { ApiResponse_TextTrialReceipt_ } from '../models/ApiResponse_TextTrialReceipt_';
import type { CanvasAssistantMessage } from '../models/CanvasAssistantMessage';
import type { LabChatCommand } from '../models/LabChatCommand';
import type { LabModels } from '../models/LabModels';
import type { TextLabCancelRequest } from '../models/TextLabCancelRequest';
import type { TextLabRunRequest } from '../models/TextLabRunRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ChatService {
    /**
     * Lab Snapshot
     * @returns ApiResponse_LabChatSnapshot_ Successful Response
     * @throws ApiError
     */
    public static chatLabSnapshot({
        sessionId,
    }: {
        sessionId: string,
    }): CancelablePromise<ApiResponse_LabChatSnapshot_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/lab/{session_id}',
            path: {
                'session_id': sessionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Lab Models
     * @returns ApiResponse_LabModels_ Successful Response
     * @throws ApiError
     */
    public static chatLabModels({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: LabModels,
    }): CancelablePromise<ApiResponse_LabModels_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/chat/sessions/lab/{session_id}/models',
            path: {
                'session_id': sessionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Lab Send
     * @returns ApiResponse_LabChatSnapshot_ Successful Response
     * @throws ApiError
     */
    public static chatLabSend({
        sessionId,
        requestBody,
    }: {
        sessionId: string,
        requestBody: LabChatCommand,
    }): CancelablePromise<ApiResponse_LabChatSnapshot_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/lab/{session_id}/turns',
            path: {
                'session_id': sessionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Lab Stop
     * @returns ApiResponse_LabChatSnapshot_ Successful Response
     * @throws ApiError
     */
    public static chatLabStop({
        sessionId,
        turnId,
    }: {
        sessionId: string,
        turnId: string,
    }): CancelablePromise<ApiResponse_LabChatSnapshot_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/lab/{session_id}/turns/{turn_id}/stop',
            path: {
                'session_id': sessionId,
                'turn_id': turnId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Lab Events
     * @returns any Successful Response
     * @throws ApiError
     */
    public static chatLabEvents({
        sessionId,
        after,
        follow = true,
        lastEventId,
    }: {
        sessionId: string,
        after?: number,
        follow?: boolean,
        lastEventId?: number,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/lab/{session_id}/events',
            path: {
                'session_id': sessionId,
            },
            headers: {
                'last-event-id': lastEventId,
            },
            query: {
                'after': after,
                'follow': follow,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Text Snapshot
     * Read existing or newly accepted trial messages in their original session.
     * @returns ApiResponse_list_ExperimentMessageRead__ Successful Response
     * @throws ApiError
     */
    public static chatTextSnapshot({
        sessionId,
        page = 1,
        pageSize = 50,
    }: {
        sessionId: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_list_ExperimentMessageRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/text/{session_id}',
            path: {
                'session_id': sessionId,
            },
            query: {
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Text Send
     * Enroll a direct provider call; SSE subscribers do not own its lifetime.
     * @returns ApiResponse_TextTrialReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatTextSend({
        sessionId,
        idempotencyKey,
        requestBody,
    }: {
        sessionId: string,
        idempotencyKey: string,
        requestBody: TextLabRunRequest,
    }): CancelablePromise<ApiResponse_TextTrialReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/text/{session_id}/turns',
            path: {
                'session_id': sessionId,
            },
            headers: {
                'idempotency-key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Text Events
     * Replay committed text trial events in session cursor order.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static chatTextEvents({
        sessionId,
        after,
        follow = true,
        lastEventId,
    }: {
        sessionId: string,
        after?: number,
        follow?: boolean,
        lastEventId?: number,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/text/{session_id}/events',
            path: {
                'session_id': sessionId,
            },
            headers: {
                'last-event-id': lastEventId,
            },
            query: {
                'after': after,
                'follow': follow,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Cancel Text Lab Stream
     * 会话绑定取消入口不复用任务中心取消 API，避免 hidden run 越权展示。
     * @returns ApiResponse_TextLabRunStatus_ Successful Response
     * @throws ApiError
     */
    public static chatTextStop({
        sessionId,
        taskId,
        requestBody,
    }: {
        sessionId: string,
        taskId: string,
        requestBody: TextLabCancelRequest,
    }): CancelablePromise<ApiResponse_TextLabRunStatus_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/text/{session_id}/turns/{task_id}/stop',
            path: {
                'session_id': sessionId,
                'task_id': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Snapshot
     * Open the canvas conversation at its latest committed cursor.
     * @returns ApiResponse_CanvasAssistantHistory_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasSnapshot({
        canvasId,
        projectId = '',
    }: {
        canvasId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantHistory_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Send
     * Accept a turn or return its existing receipt on retry.
     * @returns ApiResponse_CanvasAssistantExchange_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasSend({
        canvasId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        requestBody: CanvasAssistantMessage,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantExchange_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/turns',
            path: {
                'canvas_id': canvasId,
            },
            query: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Canvas Events
     * Subscribe or replay committed updates from a client cursor.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static chatCanvasEvents({
        canvasId,
        after,
        follow = true,
        projectId = '',
        lastEventId,
    }: {
        canvasId: string,
        after?: number,
        follow?: boolean,
        projectId?: string,
        lastEventId?: number,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/events',
            path: {
                'canvas_id': canvasId,
            },
            headers: {
                'last-event-id': lastEventId,
            },
            query: {
                'after': after,
                'follow': follow,
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
