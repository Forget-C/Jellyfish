/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasAssistantExchange_ } from '../models/ApiResponse_CanvasAssistantExchange_';
import type { ApiResponse_CanvasAssistantHistory_ } from '../models/ApiResponse_CanvasAssistantHistory_';
import type { CanvasAssistantMessage } from '../models/CanvasAssistantMessage';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ChatService {
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
