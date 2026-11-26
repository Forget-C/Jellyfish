/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasAssistantExchange_ } from '../models/ApiResponse_CanvasAssistantExchange_';
import type { ApiResponse_CanvasAssistantGenerationRead_ } from '../models/ApiResponse_CanvasAssistantGenerationRead_';
import type { ApiResponse_CanvasAssistantHistory_ } from '../models/ApiResponse_CanvasAssistantHistory_';
import type { ApiResponse_CanvasAssistantLayout_ } from '../models/ApiResponse_CanvasAssistantLayout_';
import type { ApiResponse_CanvasAssistantProposalResult_ } from '../models/ApiResponse_CanvasAssistantProposalResult_';
import type { ApiResponse_ChatSessionSnapshot_ } from '../models/ApiResponse_ChatSessionSnapshot_';
import type { ApiResponse_ChatTurnReceipt_ } from '../models/ApiResponse_ChatTurnReceipt_';
import type { ApiResponse_LabChatSnapshot_ } from '../models/ApiResponse_LabChatSnapshot_';
import type { ApiResponse_LabModels_ } from '../models/ApiResponse_LabModels_';
import type { ApiResponse_list_ExperimentMessageRead__ } from '../models/ApiResponse_list_ExperimentMessageRead__';
import type { ApiResponse_TextLabRunStatus_ } from '../models/ApiResponse_TextLabRunStatus_';
import type { ArtifactAnswer } from '../models/ArtifactAnswer';
import type { CanvasAssistantGenerationApproval } from '../models/CanvasAssistantGenerationApproval';
import type { CanvasAssistantLayoutDecision } from '../models/CanvasAssistantLayoutDecision';
import type { CanvasAssistantMessage } from '../models/CanvasAssistantMessage';
import type { CanvasAssistantProposalDecision } from '../models/CanvasAssistantProposalDecision';
import type { CanvasAssistantQuestionAnswer } from '../models/CanvasAssistantQuestionAnswer';
import type { GenerationSubmitRequest } from '../models/GenerationSubmitRequest';
import type { LabChatCommand } from '../models/LabChatCommand';
import type { LabModels } from '../models/LabModels';
import type { TextLabCancelRequest } from '../models/TextLabCancelRequest';
import type { TextLabRunRequest } from '../models/TextLabRunRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ChatService {
    /**
     * Media Snapshot
     * Restore submitted parameters, references and current task receipts.
     * @returns ApiResponse_list_ExperimentMessageRead__ Successful Response
     * @throws ApiError
     */
    public static chatMediaSnapshot({
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
            url: '/api/v1/studio/chat/sessions/media/{session_id}',
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
     * Stop Text Trial
     * Cancel a hidden run scoped to its original text trial session.
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
     * Send Turn
     * @returns ApiResponse_ChatTurnReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatSessionSend({
        sessionId,
        requestBody,
        idempotencyKey,
    }: {
        sessionId: string,
        requestBody: (CanvasAssistantMessage | LabChatCommand | TextLabRunRequest | GenerationSubmitRequest),
        idempotencyKey?: (string | null),
    }): CancelablePromise<ApiResponse_ChatTurnReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/{session_id}/turns',
            path: {
                'session_id': sessionId,
            },
            headers: {
                'Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Answer Turn
     * Admit an answer to the original paused turn and resume it independently.
     * @returns ApiResponse_ChatTurnReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatSessionAnswer({
        sessionId,
        turnId,
        requestBody,
    }: {
        sessionId: string,
        turnId: string,
        requestBody: (CanvasAssistantQuestionAnswer | ArtifactAnswer),
    }): CancelablePromise<ApiResponse_ChatTurnReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/{session_id}/turns/{turn_id}/answer',
            path: {
                'session_id': sessionId,
                'turn_id': turnId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Subscribe
     * @returns string Successful Response
     * @throws ApiError
     */
    public static chatSessionEvents({
        sessionId,
        after,
        follow = true,
        lastEventId,
    }: {
        sessionId: string,
        after?: number,
        follow?: boolean,
        lastEventId?: number,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/{session_id}/events',
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
     * Send Bound Turn
     * Admit a turn in the session identified by the path.
     * @returns ApiResponse_ChatTurnReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatBoundSend({
        kind,
        sessionId,
        requestBody,
        idempotencyKey,
    }: {
        kind: 'canvas' | 'chat' | 'text' | 'image' | 'video',
        sessionId: string,
        requestBody: (CanvasAssistantMessage | LabChatCommand | TextLabRunRequest | GenerationSubmitRequest),
        idempotencyKey?: (string | null),
    }): CancelablePromise<ApiResponse_ChatTurnReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/{kind}/{session_id}/turns',
            path: {
                'kind': kind,
                'session_id': sessionId,
            },
            headers: {
                'Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Answer Bound Turn
     * Admit an answer to a question in the bound session.
     * @returns ApiResponse_ChatTurnReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatBoundAnswer({
        kind,
        sessionId,
        turnId,
        requestBody,
    }: {
        kind: 'canvas' | 'chat' | 'text' | 'image' | 'video',
        sessionId: string,
        turnId: string,
        requestBody: (CanvasAssistantQuestionAnswer | ArtifactAnswer),
    }): CancelablePromise<ApiResponse_ChatTurnReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/{kind}/{session_id}/turns/{turn_id}/answer',
            path: {
                'kind': kind,
                'session_id': sessionId,
                'turn_id': turnId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Subscribe Bound
     * Stream committed events from a bound session.
     * @returns string Successful Response
     * @throws ApiError
     */
    public static chatBoundEvents({
        kind,
        sessionId,
        after,
        follow = true,
        lastEventId,
    }: {
        kind: 'canvas' | 'chat' | 'text' | 'image' | 'video',
        sessionId: string,
        after?: number,
        follow?: boolean,
        lastEventId?: number,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/{kind}/{session_id}/events',
            path: {
                'kind': kind,
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
     * Bound Snapshot
     * Return the public checkpoint and history for the bound session.
     * @returns ApiResponse_ChatSessionSnapshot_ Successful Response
     * @throws ApiError
     */
    public static chatBoundSnapshot({
        kind,
        sessionId,
        page = 1,
        pageSize = 50,
    }: {
        kind: 'canvas' | 'chat' | 'text' | 'image' | 'video',
        sessionId: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_ChatSessionSnapshot_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/{kind}/{session_id}/snapshot',
            path: {
                'kind': kind,
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
     * Stop Assistant Turn
     * Stop the remaining assistant work without canceling any accepted runs.
     * @returns ApiResponse_CanvasAssistantExchange_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasStop({
        canvasId,
        sourceId,
        projectId = '',
    }: {
        canvasId: string,
        sourceId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantExchange_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/turns/{source_id}/stop',
            path: {
                'canvas_id': canvasId,
                'source_id': sourceId,
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
     * Decide Assistant Proposal
     * Approve a saved preview through the existing canvas save transaction, or reject it.
     * @returns ApiResponse_CanvasAssistantProposalResult_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasDecide({
        canvasId,
        sourceId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        sourceId: string,
        requestBody: CanvasAssistantProposalDecision,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantProposalResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/proposals/{source_id}',
            path: {
                'canvas_id': canvasId,
                'source_id': sourceId,
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
     * Decide Layout
     * Approve a local layout or record the editing browser's result.
     * @returns ApiResponse_CanvasAssistantLayout_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasLayout({
        canvasId,
        sourceId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        sourceId: string,
        requestBody: CanvasAssistantLayoutDecision,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantLayout_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/layout/{source_id}',
            path: {
                'canvas_id': canvasId,
                'source_id': sourceId,
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
     * Reapprove Canvas Generation
     * Accept the exact changed generation input without resubmitting earlier versions.
     * @returns ApiResponse_CanvasAssistantGenerationRead_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasGeneration({
        canvasId,
        sourceId,
        requestBody,
        projectId = '',
    }: {
        canvasId: string,
        sourceId: string,
        requestBody: CanvasAssistantGenerationApproval,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantGenerationRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/generations/{source_id}/approval',
            path: {
                'canvas_id': canvasId,
                'source_id': sourceId,
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
     * Canvas Stop Snapshot
     * Confirm the stop together with the new cursor and current assistant state.
     * @returns ApiResponse_CanvasAssistantHistory_ Successful Response
     * @throws ApiError
     */
    public static chatCanvasStopSnapshot({
        canvasId,
        sourceId,
        projectId = '',
    }: {
        canvasId: string,
        sourceId: string,
        projectId?: string,
    }): CancelablePromise<ApiResponse_CanvasAssistantHistory_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/chat/sessions/canvas/{canvas_id}/turns/{source_id}/stop/snapshot',
            path: {
                'canvas_id': canvasId,
                'source_id': sourceId,
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
     * Bound Media Receipt
     * Look up an accepted media request without changing its task or event history.
     * @returns ApiResponse_ChatTurnReceipt_ Successful Response
     * @throws ApiError
     */
    public static chatBoundMediaReceipt({
        kind,
        sessionId,
        requestId,
    }: {
        kind: 'canvas' | 'chat' | 'text' | 'image' | 'video',
        sessionId: string,
        requestId: string,
    }): CancelablePromise<ApiResponse_ChatTurnReceipt_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/chat/sessions/{kind}/{session_id}/requests/{request_id}',
            path: {
                'kind': kind,
                'session_id': sessionId,
                'request_id': requestId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
