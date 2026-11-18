/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AIRequest } from '../models/AIRequest';
import type { ApiResponse_AssetSummary_ } from '../models/ApiResponse_AssetSummary_';
import type { ApiResponse_BatchRead_ } from '../models/ApiResponse_BatchRead_';
import type { ApiResponse_CanvasRead_ } from '../models/ApiResponse_CanvasRead_';
import type { ApiResponse_ChapterAssemblyRead_ } from '../models/ApiResponse_ChapterAssemblyRead_';
import type { ApiResponse_ChapterDeliveriesRead_ } from '../models/ApiResponse_ChapterDeliveriesRead_';
import type { ApiResponse_ChapterOverview_ } from '../models/ApiResponse_ChapterOverview_';
import type { ApiResponse_ChapterSequences_ } from '../models/ApiResponse_ChapterSequences_';
import type { ApiResponse_ChapterWorkbenchManagement_ } from '../models/ApiResponse_ChapterWorkbenchManagement_';
import type { ApiResponse_CompileResult_ } from '../models/ApiResponse_CompileResult_';
import type { ApiResponse_ContinuityRead_ } from '../models/ApiResponse_ContinuityRead_';
import type { ApiResponse_CutFrameRead_ } from '../models/ApiResponse_CutFrameRead_';
import type { ApiResponse_DirectingTaskRead_ } from '../models/ApiResponse_DirectingTaskRead_';
import type { ApiResponse_DivisionAnalysisDetail_ } from '../models/ApiResponse_DivisionAnalysisDetail_';
import type { ApiResponse_DivisionHistoryPage_ } from '../models/ApiResponse_DivisionHistoryPage_';
import type { ApiResponse_DivisionPreview_ } from '../models/ApiResponse_DivisionPreview_';
import type { ApiResponse_DivisionReceiptDetail_ } from '../models/ApiResponse_DivisionReceiptDetail_';
import type { ApiResponse_DivisionSaved_ } from '../models/ApiResponse_DivisionSaved_';
import type { ApiResponse_DivisionVersionDetail_ } from '../models/ApiResponse_DivisionVersionDetail_';
import type { ApiResponse_EditableRevisionFields_ } from '../models/ApiResponse_EditableRevisionFields_';
import type { ApiResponse_ExtractedFrame_ } from '../models/ApiResponse_ExtractedFrame_';
import type { ApiResponse_FeedbackRead_ } from '../models/ApiResponse_FeedbackRead_';
import type { ApiResponse_LedgerRead_ } from '../models/ApiResponse_LedgerRead_';
import type { ApiResponse_list_AssetSummary__ } from '../models/ApiResponse_list_AssetSummary__';
import type { ApiResponse_list_BatchRead__ } from '../models/ApiResponse_list_BatchRead__';
import type { ApiResponse_list_ProjectStyleRevision__ } from '../models/ApiResponse_list_ProjectStyleRevision__';
import type { ApiResponse_list_SceneDeliveryRead__ } from '../models/ApiResponse_list_SceneDeliveryRead__';
import type { ApiResponse_list_SequenceRead__ } from '../models/ApiResponse_list_SequenceRead__';
import type { ApiResponse_list_SourceRead__ } from '../models/ApiResponse_list_SourceRead__';
import type { ApiResponse_list_StoryboardTaskSummary__ } from '../models/ApiResponse_list_StoryboardTaskSummary__';
import type { ApiResponse_MediaRead_ } from '../models/ApiResponse_MediaRead_';
import type { ApiResponse_ReviewRevisionApplication_ } from '../models/ApiResponse_ReviewRevisionApplication_';
import type { ApiResponse_SceneCanvasesRead_ } from '../models/ApiResponse_SceneCanvasesRead_';
import type { ApiResponse_SceneObjectCandidateReceipt_ } from '../models/ApiResponse_SceneObjectCandidateReceipt_';
import type { ApiResponse_SceneObjectCandidateReview_ } from '../models/ApiResponse_SceneObjectCandidateReview_';
import type { ApiResponse_SceneObjectsRead_ } from '../models/ApiResponse_SceneObjectsRead_';
import type { ApiResponse_SceneObjectTaskRead_ } from '../models/ApiResponse_SceneObjectTaskRead_';
import type { ApiResponse_SequenceRead_ } from '../models/ApiResponse_SequenceRead_';
import type { ApiResponse_StoryboardBasis_ } from '../models/ApiResponse_StoryboardBasis_';
import type { ApiResponse_StoryboardDiff_ } from '../models/ApiResponse_StoryboardDiff_';
import type { ApiResponse_StoryboardRetryBasis_ } from '../models/ApiResponse_StoryboardRetryBasis_';
import type { ApiResponse_StoryboardTaskRead_ } from '../models/ApiResponse_StoryboardTaskRead_';
import type { ApiResponse_TaskAccepted_ } from '../models/ApiResponse_TaskAccepted_';
import type { ApiResponse_Union_DivisionSaved__NoneType__ } from '../models/ApiResponse_Union_DivisionSaved__NoneType__';
import type { ApiResponse_VideoReferenceCapabilities_ } from '../models/ApiResponse_VideoReferenceCapabilities_';
import type { ApiResponse_WorkspaceRead_ } from '../models/ApiResponse_WorkspaceRead_';
import type { ApplyDesignRequest } from '../models/ApplyDesignRequest';
import type { ApplyReviewRevisionRequest } from '../models/ApplyReviewRevisionRequest';
import type { AssetCreateRequest } from '../models/AssetCreateRequest';
import type { BatchPrepare } from '../models/BatchPrepare';
import type { CompileRequest } from '../models/CompileRequest';
import type { CutFrameRequest } from '../models/CutFrameRequest';
import type { DivisionDraft } from '../models/DivisionDraft';
import type { DivisionSave } from '../models/DivisionSave';
import type { ExtractFrameRequest } from '../models/ExtractFrameRequest';
import type { FeedbackWrite } from '../models/FeedbackWrite';
import type { ObjectExtractionRequest } from '../models/ObjectExtractionRequest';
import type { RegroupRequest } from '../models/RegroupRequest';
import type { RepairPlanRequest } from '../models/RepairPlanRequest';
import type { ReviewDecisionRequest } from '../models/ReviewDecisionRequest';
import type { ReviewRequest } from '../models/ReviewRequest';
import type { ReviewRevisionRequest } from '../models/ReviewRevisionRequest';
import type { RevisionWrite } from '../models/RevisionWrite';
import type { SceneCanvasCreate } from '../models/SceneCanvasCreate';
import type { SceneObjectCandidateApplication } from '../models/SceneObjectCandidateApplication';
import type { SceneObjectChoice } from '../models/SceneObjectChoice';
import type { SeamReviewRequest } from '../models/SeamReviewRequest';
import type { SequenceCreate } from '../models/SequenceCreate';
import type { SequenceUpdate } from '../models/SequenceUpdate';
import type { ShootRequest } from '../models/ShootRequest';
import type { SourceResolveRequest } from '../models/SourceResolveRequest';
import type { StoryboardApplication } from '../models/StoryboardApplication';
import type { StoryboardCheckRequest } from '../models/StoryboardCheckRequest';
import type { StoryboardReextractRequest } from '../models/StoryboardReextractRequest';
import type { StoryboardRequest } from '../models/StoryboardRequest';
import type { StoryboardRestore } from '../models/StoryboardRestore';
import type { StoryboardRetry } from '../models/StoryboardRetry';
import type { StyleWrite } from '../models/StyleWrite';
import type { TakeReviewWrite } from '../models/TakeReviewWrite';
import type { TransitionWrite_Input } from '../models/TransitionWrite_Input';
import type { VersionRequest } from '../models/VersionRequest';
import type { VisualRequest } from '../models/VisualRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioDirectingService {
    /**
     * Reference Capabilities
     * 返回当前视频适配范围，实际提交仍由服务校验文件与组合。
     * @returns ApiResponse_VideoReferenceCapabilities_ Successful Response
     * @throws ApiError
     */
    public static directingReferenceCapabilities({
        projectId,
        modelId,
    }: {
        projectId: string,
        modelId: string,
    }): CancelablePromise<ApiResponse_VideoReferenceCapabilities_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/video-models/{model_id}/reference-capabilities',
            path: {
                'project_id': projectId,
                'model_id': modelId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter
     * 返回章节原文和有序场次。
     * @returns ApiResponse_ChapterSequences_ Successful Response
     * @throws ApiError
     */
    public static directingChapter({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterSequences_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Canvases
     * 读取场次准备页的原文摘要与独立画布。
     * @returns ApiResponse_SceneCanvasesRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneCanvases({
        projectId,
        chapterId,
        sequenceId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_SceneCanvasesRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Scene Canvas
     * 建立本场空白画布及固定原文依据。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneCanvasCreate({
        projectId,
        chapterId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        requestBody: SceneCanvasCreate,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Objects
     * 读取当前对象候选、准备图片及最近的提取任务。
     * @returns ApiResponse_SceneObjectsRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjects({
        projectId,
        chapterId,
        sequenceId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_SceneObjectsRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Extract Scene Objects
     * 明确启动场次对象提取，不提交媒体或分镜。
     * @returns ApiResponse_SceneObjectTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjectExtract({
        projectId,
        chapterId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        requestBody: ObjectExtractionRequest,
    }): CancelablePromise<ApiResponse_SceneObjectTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Read Scene Object Candidate
     * 读取指定对象提取任务，可用时返回冻结对象和当前准备的整批差异。
     * @returns ApiResponse_SceneObjectCandidateReview_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjectCandidate({
        projectId,
        chapterId,
        sequenceId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_SceneObjectCandidateReview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/candidate',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Discard Scene Object Candidate
     * 忽略本次未应用候选，保留已保存的对象与资源引用。
     * @returns ApiResponse_SceneObjectTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjectCandidateDiscard({
        projectId,
        chapterId,
        sequenceId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_SceneObjectTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/discard',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Scene Object Candidate
     * 确认应用已核对的整批对象，响应未知可用相同命令核实。
     * @returns ApiResponse_SceneObjectCandidateReceipt_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjectCandidateApply({
        projectId,
        chapterId,
        sequenceId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
        requestBody: SceneObjectCandidateApplication,
    }): CancelablePromise<ApiResponse_SceneObjectCandidateReceipt_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/apply',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
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
     * Choose Scene Object Reference
     * 只保存本场对象候选的资产和参考图片选择。
     * @returns ApiResponse_SceneObjectsRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneObjectChoose({
        projectId,
        chapterId,
        sequenceId,
        objectId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        objectId: string,
        requestBody: SceneObjectChoice,
    }): CancelablePromise<ApiResponse_SceneObjectsRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/objects/{object_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'object_id': objectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Storyboard
     * 显式建立目标画布并提交文本分镜任务。
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardSubmit({
        projectId,
        chapterId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        requestBody: StoryboardRequest,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Storyboards
     * 读取本场或本画布近期任务的真实状态。
     * @returns ApiResponse_list_StoryboardTaskSummary__ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardList({
        projectId,
        chapterId,
        sequenceId,
        canvasId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        canvasId?: (string | null),
    }): CancelablePromise<ApiResponse_list_StoryboardTaskSummary__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            query: {
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Storyboard Basis
     * 读取创建分镜画布前用户可核对的实际依据。
     * @returns ApiResponse_StoryboardBasis_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardBasis({
        projectId,
        chapterId,
        sequenceId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_StoryboardBasis_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/basis',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Read Canvas Candidate
     * 为共同工作区读取同一目标画布的待应用候选。
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardCandidate({
        projectId,
        chapterId,
        sequenceId,
        canvasId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        canvasId: string,
        taskId?: (string | null),
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/storyboards/candidate',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'canvas_id': canvasId,
            },
            query: {
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Reextract Storyboard
     * 针对既有场次画布创建可核对的重新提取任务。
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardReextract({
        projectId,
        chapterId,
        sequenceId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        canvasId: string,
        requestBody: StoryboardReextractRequest,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/storyboards',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Retry Storyboard
     * 在同一画布恢复失败任务，原任务及已保存内容保持可查。
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardRetry({
        projectId,
        chapterId,
        sequenceId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
        requestBody: StoryboardRetry,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/retry',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
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
     * Read Saved Storyboard Check
     * Read the latest explicit check without starting work.
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingSavedStoryboardCheckGet({
        projectId,
        chapterId,
        sequenceId,
        canvasId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/continuity-check',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Saved Storyboard Check
     * Review the saved design only after explicit admission.
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingSavedStoryboardCheckSubmit({
        projectId,
        chapterId,
        sequenceId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        canvasId: string,
        requestBody: StoryboardCheckRequest,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/continuity-check',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Storyboard Retry Basis
     * 读取重试原画布时实际采用的原文、对象参考和模型。
     * @returns ApiResponse_StoryboardRetryBasis_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardRetryBasis({
        projectId,
        chapterId,
        sequenceId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_StoryboardRetryBasis_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/retry/basis',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Read Storyboard
     * 读取当前任务状态、候选和应用基线。
     * @returns ApiResponse_StoryboardTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardGet({
        projectId,
        chapterId,
        sequenceId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_StoryboardTaskRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Preview Storyboard Application
     * 核对当前修订的卡片差异及保留影响。
     * @returns ApiResponse_StoryboardDiff_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardDiff({
        projectId,
        chapterId,
        sequenceId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
        requestBody: StoryboardApplication,
    }): CancelablePromise<ApiResponse_StoryboardDiff_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/diff',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
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
     * Apply Storyboard
     * 明确应用本场候选，原子保存已核对的共同文档。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardApply({
        projectId,
        chapterId,
        sequenceId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
        requestBody: StoryboardApplication,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/apply',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
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
     * Restore Storyboard
     * 在真实应用回执约束下撤销或重做同一批次。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static directingStoryboardRestore({
        projectId,
        chapterId,
        sequenceId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        taskId: string,
        requestBody: StoryboardRestore,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/restore',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
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
     * Chapter Workbench Management
     * 读取章节工作台管理的轻量摘要。
     * @returns ApiResponse_ChapterWorkbenchManagement_ Successful Response
     * @throws ApiError
     */
    public static directingChapterWorkbenchManagement({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterWorkbenchManagement_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/workbench-management',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter Overview
     * 返回有序场次的整场计数与已确认采用身份。
     * @returns ApiResponse_ChapterOverview_ Successful Response
     * @throws ApiError
     */
    public static directingChapterOverview({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterOverview_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/overview',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter History
     * 按需列出历史场次，不参与当前数量与章节组合。
     * @returns ApiResponse_list_SequenceRead__ Successful Response
     * @throws ApiError
     */
    public static directingChapterHistory({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_list_SequenceRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/history',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Division History
     * 分页列出保存版本及未关联的分析记录，不加载所有历史正文。
     * @returns ApiResponse_DivisionHistoryPage_ Successful Response
     * @throws ApiError
     */
    public static directingDivisionHistory({
        projectId,
        chapterId,
        page = 1,
        pageSize = 20,
    }: {
        projectId: string,
        chapterId: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_DivisionHistoryPage_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/history',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
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
     * Division Version
     * 按需读取保存时的完整快照；查看不切换当前版本。
     * @returns ApiResponse_DivisionVersionDetail_ Successful Response
     * @throws ApiError
     */
    public static directingDivisionVersion({
        projectId,
        chapterId,
        versionId,
    }: {
        projectId: string,
        chapterId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_DivisionVersionDetail_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/versions/{version_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Division Legacy Receipt
     * 只读查看尚未接入的旧保存记录，缺失数据保留说明。
     * @returns ApiResponse_DivisionReceiptDetail_ Successful Response
     * @throws ApiError
     */
    public static directingDivisionLegacyReceipt({
        projectId,
        chapterId,
        requestId,
    }: {
        projectId: string,
        chapterId: string,
        requestId: string,
    }): CancelablePromise<ApiResponse_DivisionReceiptDetail_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/history/receipts/{request_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'request_id': requestId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Division Analysis
     * 展开分析时读取业务快照，旧资料缺失不冒充完整版本。
     * @returns ApiResponse_DivisionAnalysisDetail_ Successful Response
     * @throws ApiError
     */
    public static directingDivisionAnalysis({
        projectId,
        chapterId,
        taskId,
    }: {
        projectId: string,
        chapterId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_DivisionAnalysisDetail_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/analyses/{task_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Preview Division
     * 校验最终范围和完整集合，返回实际影响及阻塞；不写正式场次。
     * @returns ApiResponse_DivisionPreview_ Successful Response
     * @throws ApiError
     */
    public static directingPreviewDivision({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: DivisionDraft,
    }): CancelablePromise<ApiResponse_DivisionPreview_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/preview',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Division
     * 确认预览后原子保存；同请求同内容重试返回回执，不重复创建。
     * @returns ApiResponse_DivisionSaved_ Successful Response
     * @throws ApiError
     */
    public static directingSaveDivision({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: DivisionSave,
    }): CancelablePromise<ApiResponse_DivisionSaved_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Division Receipt
     * 响应丢失后核对回执；不存在返回 null，不能据此更换请求身份盲目重放。
     * @returns ApiResponse_Union_DivisionSaved__NoneType__ Successful Response
     * @throws ApiError
     */
    public static directingDivisionReceipt({
        projectId,
        chapterId,
        requestId,
    }: {
        projectId: string,
        chapterId: string,
        requestId: string,
    }): CancelablePromise<ApiResponse_Union_DivisionSaved__NoneType__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/division/receipts/{request_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'request_id': requestId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Sequence
     * 确认非空连续原文为正式场次；与同版本已有场次重叠时返回冲突。
     * @returns ApiResponse_SequenceRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSequence({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: SequenceCreate,
    }): CancelablePromise<ApiResponse_SequenceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Sequence
     * 比较版本修改名称/顺序；仅显式提交 span 才核对来源，新范围不得重叠。
     * @returns ApiResponse_SequenceRead_ Successful Response
     * @throws ApiError
     */
    public static directingUpdateSequence({
        projectId,
        chapterId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        sequenceId: string,
        requestBody: SequenceUpdate,
    }): CancelablePromise<ApiResponse_SequenceRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/sequences/{sequence_id}',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Workspace
     * 三视图读取同一份场次上下文。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingWorkspace({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Resolve Sources
     * 批量只读解析来源，归属与历史匹配规则由领域服务维护。
     * @returns ApiResponse_list_SourceRead__ Successful Response
     * @throws ApiError
     */
    public static directingResolveSources({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: SourceResolveRequest,
    }): CancelablePromise<ApiResponse_list_SourceRead__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/sources/resolve',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Revision
     * 保存设计、计划或粗剪草稿。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingSaveRevision({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: RevisionWrite,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/revisions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Revision
     * 登记本地单用户工作台的显式确认动作。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmRevision({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/revisions/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Analyze
     * 提交原文划场建议，结果通过通用任务查询。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingAnalyzeChapter({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: AIRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/analyze',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Design
     * 提交带起始版本的六岗导演设计建议。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingGenerateDesign({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: AIRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/design',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Design
     * 显式采用已完成任务建议，迟到结果保留为独立草稿。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingApplyDesign({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ApplyDesignRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/design/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Compile Unit
     * 明确授权编译所选单元，生成不可变提示词。
     * @returns ApiResponse_CompileResult_ Successful Response
     * @throws ApiError
     */
    public static directingCompile({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: CompileRequest,
    }): CancelablePromise<ApiResponse_CompileResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/compile',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review
     * 对固定提示词提交六岗联合审查。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingReview({
        projectId,
        sequenceId,
        promptId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        promptId: string,
        requestBody: ReviewRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/prompts/{prompt_id}/review',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'prompt_id': promptId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Review
     * 保存实际审稿结论供用户查看、修改方案或选择执行。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingApplyReview({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ApplyDesignRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Shoot
     * 确认固定输入并开始单元试拍，重复请求返回同一任务。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingShoot({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ShootRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/shoot',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Annotate Take
     * 保存过保修废、实际覆盖和保留区间。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingAnnotateTake({
        projectId,
        sequenceId,
        takeId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
        requestBody: TakeReviewWrite,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Take Media
     * 返回经归属校验的播放器地址，前端不自行拼接后端接口。
     * @returns ApiResponse_MediaRead_ Successful Response
     * @throws ApiError
     */
    public static directingTakeMedia({
        projectId,
        sequenceId,
        takeId,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
    }): CancelablePromise<ApiResponse_MediaRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}/media',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Take Thumbnail
     * 读取同等归属保护的真实视频缩略图，派生缓存由服务处理。
     * @returns binary Successful Response
     * @throws ApiError
     */
    public static directingTakeThumbnail({
        projectId,
        sequenceId,
        takeId,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
    }): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}/thumbnail',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Resolve Review
     * 派生保留人工取舍的审稿版本，原报告保持不变。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingResolveReview({
        projectId,
        sequenceId,
        reviewId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        reviewId: string,
        requestBody: ReviewDecisionRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/reviews/{review_id}/resolve',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'review_id': reviewId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Task Detail
     * 读取当前项目的导演建议和错误，保持业务结果在场次面板。
     * @returns ApiResponse_DirectingTaskRead_ Successful Response
     * @throws ApiError
     */
    public static directingTask({
        projectId,
        taskId,
    }: {
        projectId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_DirectingTaskRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/tasks/{task_id}',
            path: {
                'project_id': projectId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Styles
     * 读取项目的候选与确认风格版本。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingStyles({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/styles',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Style
     * 保存或派生风格草稿，不自动启用。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingSaveStyle({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: StyleWrite,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/styles',
            path: {
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
     * Confirm Style
     * 记录人工确认的项目风格版本。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingConfirmStyle({
        projectId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/styles/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Generate Visual
     * 提交基于已确认设计的验证图，产物保留为候选。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingGenerateVisual({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: VisualRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/images',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Assets
     * 返回当前项目内可关联的角色、场所与道具。
     * @returns ApiResponse_list_AssetSummary__ Successful Response
     * @throws ApiError
     */
    public static directingAssets({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_AssetSummary__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/assets',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Asset
     * 返回本次创建的精确资产身份；请求可重试，设计关联仍须另行保存。
     * @returns ApiResponse_AssetSummary_ Successful Response
     * @throws ApiError
     */
    public static directingCreateAsset({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: AssetCreateRequest,
    }): CancelablePromise<ApiResponse_AssetSummary_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/assets',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Extract Frame
     * 从已归档 Take 的真实位置提取连续性参考图。
     * @returns ApiResponse_ExtractedFrame_ Successful Response
     * @throws ApiError
     */
    public static directingExtractFrame({
        projectId,
        sequenceId,
        takeId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        takeId: string,
        requestBody: ExtractFrameRequest,
    }): CancelablePromise<ApiResponse_ExtractedFrame_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take_id}/frame',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'take_id': takeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Prepare Batch
     * 固定本轮选择并返回逐项预检，不执行模型请求。
     * @returns ApiResponse_BatchRead_ Successful Response
     * @throws ApiError
     */
    public static directingPrepareBatch({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: BatchPrepare,
    }): CancelablePromise<ApiResponse_BatchRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches/prepare',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Batches
     * 恢复本场固定批次及各项通用任务状态。
     * @returns ApiResponse_list_BatchRead__ Successful Response
     * @throws ApiError
     */
    public static directingBatches({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_list_BatchRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Batch
     * 显式受理已预检批次，重复请求不会新增任务。
     * @returns ApiResponse_BatchRead_ Successful Response
     * @throws ApiError
     */
    public static directingSubmitBatch({
        projectId,
        sequenceId,
        batchId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        batchId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_BatchRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/batches/{batch_id}/submit',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'batch_id': batchId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Regroup Units
     * 显式拆分/组合产生新计划草稿，原计划和已有素材保持不变。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingRegroupUnits({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: RegroupRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/regroup',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Continuity
     * 返回当前真实连续性与局部失效状态。
     * @returns ApiResponse_ContinuityRead_ Successful Response
     * @throws ApiError
     */
    public static directingContinuity({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_ContinuityRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/continuity',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Cut Frame
     * 从已确认采用区间提帧并固定来源。
     * @returns ApiResponse_CutFrameRead_ Successful Response
     * @throws ApiError
     */
    public static directingCutFrame({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: CutFrameRequest,
    }): CancelablePromise<ApiResponse_CutFrameRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/cut-frames',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review Seam
     * 保存针对真实相邻片段的人工接缝结论。
     * @returns ApiResponse_ContinuityRead_ Successful Response
     * @throws ApiError
     */
    public static directingReviewSeam({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: SeamReviewRequest,
    }): CancelablePromise<ApiResponse_ContinuityRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/seam-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Feedback
     * 返回当前验收、返工与经验候选的持久版本。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingFeedback({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Feedback
     * 保存强类型反馈草稿，艺术判断由其来源承担。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingSaveFeedback({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: FeedbackWrite,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Feedback
     * 显式确认当前反馈草稿，旧采用上的审片不能成为当前验收。
     * @returns ApiResponse_FeedbackRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmFeedback({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<ApiResponse_FeedbackRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/feedback/{revision_id}/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Ledger
     * 只读汇总三本账，不提供第二份台账编辑入口。
     * @returns ApiResponse_LedgerRead_ Successful Response
     * @throws ApiError
     */
    public static directingLedger({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_LedgerRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/ledger',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter Deliveries
     * 读取章节明确使用的固定场次内容。
     * @returns ApiResponse_ChapterDeliveriesRead_ Successful Response
     * @throws ApiError
     */
    public static directingChapterDeliveries({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterDeliveriesRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/deliveries',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Deliveries
     * 读取原场次的全部固定交付来源。
     * @returns ApiResponse_list_SceneDeliveryRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneDeliveries({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_list_SceneDeliveryRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/deliveries',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Chapter Assembly
     * 查询章节顺序播放依据、验收缺口与跨场审查。
     * @returns ApiResponse_ChapterAssemblyRead_ Successful Response
     * @throws ApiError
     */
    public static directingChapterAssembly({
        projectId,
        chapterId,
    }: {
        projectId: string,
        chapterId: string,
    }): CancelablePromise<ApiResponse_ChapterAssemblyRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/assembly',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Review Transition
     * 保存人工跨场审查，校验相邻顺序及实际边界。
     * @returns ApiResponse_ChapterAssemblyRead_ Successful Response
     * @throws ApiError
     */
    public static directingReviewTransition({
        projectId,
        chapterId,
        requestBody,
    }: {
        projectId: string,
        chapterId: string,
        requestBody: TransitionWrite_Input,
    }): CancelablePromise<ApiResponse_ChapterAssemblyRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/chapters/{chapter_id}/transitions',
            path: {
                'project_id': projectId,
                'chapter_id': chapterId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Knowledge Style
     * 从已确认经验显式准备项目风格草稿，未自动确认或应用。
     * @returns ApiResponse_list_ProjectStyleRevision__ Successful Response
     * @throws ApiError
     */
    public static directingKnowledgeStyle({
        projectId,
        sequenceId,
        revisionId,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
    }): CancelablePromise<ApiResponse_list_ProjectStyleRevision__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/knowledge/{revision_id}/style',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Prepare Repair Plan
     * 从确认的返工单创建显式局部生产草稿，继续走正常确认、编译和执行。
     * @returns ApiResponse_WorkspaceRead_ Successful Response
     * @throws ApiError
     */
    public static directingPrepareRepairPlan({
        projectId,
        sequenceId,
        revisionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        revisionId: string,
        requestBody: RepairPlanRequest,
    }): CancelablePromise<ApiResponse_WorkspaceRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/repairs/{revision_id}/plan',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'revision_id': revisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Generate Review Revision
     * 冻结检查和方向并生成局部候选，不写入设计。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingGenerateReviewRevision({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ReviewRevisionRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review-revisions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Apply Review Revision
     * 采用已展示修改并恢复编译与重新检查，绝不提交拍摄。
     * @returns ApiResponse_ReviewRevisionApplication_ Successful Response
     * @throws ApiError
     */
    public static directingApplyReviewRevision({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ApplyReviewRevisionRequest,
    }): CancelablePromise<ApiResponse_ReviewRevisionApplication_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review-revisions/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Revision Fields
     * 读取当前指令允许修改的字段。
     * @returns ApiResponse_EditableRevisionFields_ Successful Response
     * @throws ApiError
     */
    public static directingRevisionFields({
        projectId,
        sequenceId,
        promptRevisionId,
    }: {
        projectId: string,
        sequenceId: string,
        promptRevisionId: string,
    }): CancelablePromise<ApiResponse_EditableRevisionFields_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review-revisions/fields',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            query: {
                'prompt_revision_id': promptRevisionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Preview Review Revision
     * 直接编辑生成可恢复的同步预览，不调用 AI。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingPreviewReviewRevision({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: ReviewRevisionRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/review-revisions/preview',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
