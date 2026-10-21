/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AIRequest } from '../models/AIRequest';
import type { ApiResponse_AssetSummary_ } from '../models/ApiResponse_AssetSummary_';
import type { ApiResponse_BatchRead_ } from '../models/ApiResponse_BatchRead_';
import type { ApiResponse_ChapterAssemblyRead_ } from '../models/ApiResponse_ChapterAssemblyRead_';
import type { ApiResponse_ChapterDeliveriesRead_ } from '../models/ApiResponse_ChapterDeliveriesRead_';
import type { ApiResponse_ChapterOverview_ } from '../models/ApiResponse_ChapterOverview_';
import type { ApiResponse_ChapterSequences_ } from '../models/ApiResponse_ChapterSequences_';
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
import type { ApiResponse_InstructionBasisRead_ } from '../models/ApiResponse_InstructionBasisRead_';
import type { ApiResponse_InstructionCheckComparison_ } from '../models/ApiResponse_InstructionCheckComparison_';
import type { ApiResponse_InstructionCheckConfirmation_ } from '../models/ApiResponse_InstructionCheckConfirmation_';
import type { ApiResponse_LedgerRead_ } from '../models/ApiResponse_LedgerRead_';
import type { ApiResponse_list_AssetSummary__ } from '../models/ApiResponse_list_AssetSummary__';
import type { ApiResponse_list_BatchRead__ } from '../models/ApiResponse_list_BatchRead__';
import type { ApiResponse_list_InstructionCheckRead__ } from '../models/ApiResponse_list_InstructionCheckRead__';
import type { ApiResponse_list_ProjectStyleRevision__ } from '../models/ApiResponse_list_ProjectStyleRevision__';
import type { ApiResponse_list_SceneCutReviewRead__ } from '../models/ApiResponse_list_SceneCutReviewRead__';
import type { ApiResponse_list_SceneDeliveryRead__ } from '../models/ApiResponse_list_SceneDeliveryRead__';
import type { ApiResponse_list_SceneDesignSuggestionRead__ } from '../models/ApiResponse_list_SceneDesignSuggestionRead__';
import type { ApiResponse_list_SceneEndFrameRead__ } from '../models/ApiResponse_list_SceneEndFrameRead__';
import type { ApiResponse_list_SceneExportRead__ } from '../models/ApiResponse_list_SceneExportRead__';
import type { ApiResponse_list_SceneInstructionSuggestionRead__ } from '../models/ApiResponse_list_SceneInstructionSuggestionRead__';
import type { ApiResponse_list_SceneSeamReviewRead__ } from '../models/ApiResponse_list_SceneSeamReviewRead__';
import type { ApiResponse_list_SceneTakeLibraryRead__ } from '../models/ApiResponse_list_SceneTakeLibraryRead__';
import type { ApiResponse_list_SceneTakeReviewRead__ } from '../models/ApiResponse_list_SceneTakeReviewRead__';
import type { ApiResponse_list_SceneUnitDesignSuggestionRead__ } from '../models/ApiResponse_list_SceneUnitDesignSuggestionRead__';
import type { ApiResponse_list_SceneVersionRead__ } from '../models/ApiResponse_list_SceneVersionRead__';
import type { ApiResponse_list_SceneVideoRead__ } from '../models/ApiResponse_list_SceneVideoRead__';
import type { ApiResponse_list_SequenceRead__ } from '../models/ApiResponse_list_SequenceRead__';
import type { ApiResponse_list_SourceRead__ } from '../models/ApiResponse_list_SourceRead__';
import type { ApiResponse_MediaRead_ } from '../models/ApiResponse_MediaRead_';
import type { ApiResponse_ReviewRevisionApplication_ } from '../models/ApiResponse_ReviewRevisionApplication_';
import type { ApiResponse_SceneCopyReadiness_ } from '../models/ApiResponse_SceneCopyReadiness_';
import type { ApiResponse_SceneCutReviewRead_ } from '../models/ApiResponse_SceneCutReviewRead_';
import type { ApiResponse_SceneDeliveryRead_ } from '../models/ApiResponse_SceneDeliveryRead_';
import type { ApiResponse_SceneDesignPreview_ } from '../models/ApiResponse_SceneDesignPreview_';
import type { ApiResponse_SceneEndFrameRead_ } from '../models/ApiResponse_SceneEndFrameRead_';
import type { ApiResponse_SceneExportInspection_ } from '../models/ApiResponse_SceneExportInspection_';
import type { ApiResponse_SceneExportRead_ } from '../models/ApiResponse_SceneExportRead_';
import type { ApiResponse_SceneInstructionApply_ } from '../models/ApiResponse_SceneInstructionApply_';
import type { ApiResponse_SceneInstructionPreview_ } from '../models/ApiResponse_SceneInstructionPreview_';
import type { ApiResponse_SceneSeamReviewRead_ } from '../models/ApiResponse_SceneSeamReviewRead_';
import type { ApiResponse_SceneTakeReviewRead_ } from '../models/ApiResponse_SceneTakeReviewRead_';
import type { ApiResponse_SceneUnitDesignPreview_ } from '../models/ApiResponse_SceneUnitDesignPreview_';
import type { ApiResponse_SceneVersionContent_ } from '../models/ApiResponse_SceneVersionContent_';
import type { ApiResponse_SceneVersionRead_ } from '../models/ApiResponse_SceneVersionRead_';
import type { ApiResponse_SceneVideoPreparation_ } from '../models/ApiResponse_SceneVideoPreparation_';
import type { ApiResponse_SceneVideoSaveResult_ } from '../models/ApiResponse_SceneVideoSaveResult_';
import type { ApiResponse_SequenceRead_ } from '../models/ApiResponse_SequenceRead_';
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
import type { InstructionBasisConfirm } from '../models/InstructionBasisConfirm';
import type { InstructionCheckRequest } from '../models/InstructionCheckRequest';
import type { RegroupRequest } from '../models/RegroupRequest';
import type { RepairPlanRequest } from '../models/RepairPlanRequest';
import type { ReviewDecisionRequest } from '../models/ReviewDecisionRequest';
import type { ReviewRequest } from '../models/ReviewRequest';
import type { ReviewRevisionRequest } from '../models/ReviewRevisionRequest';
import type { RevisionWrite } from '../models/RevisionWrite';
import type { SceneCutReviewCreate } from '../models/SceneCutReviewCreate';
import type { SceneDeliveryCreate } from '../models/SceneDeliveryCreate';
import type { SceneDesignPreviewRequest } from '../models/SceneDesignPreviewRequest';
import type { SceneDesignRequest } from '../models/SceneDesignRequest';
import type { SceneEndFrameCreate } from '../models/SceneEndFrameCreate';
import type { SceneExportInspect } from '../models/SceneExportInspect';
import type { SceneExportRequest } from '../models/SceneExportRequest';
import type { SceneExportRetry } from '../models/SceneExportRetry';
import type { SceneInstructionRequest } from '../models/SceneInstructionRequest';
import type { SceneSeamReviewCreate } from '../models/SceneSeamReviewCreate';
import type { SceneTakeReviewConfirm } from '../models/SceneTakeReviewConfirm';
import type { SceneUnitDesignPreviewRequest } from '../models/SceneUnitDesignPreviewRequest';
import type { SceneUnitDesignRequest_Input } from '../models/SceneUnitDesignRequest_Input';
import type { SceneVersionCopy } from '../models/SceneVersionCopy';
import type { SceneVersionCreate } from '../models/SceneVersionCreate';
import type { SceneVersionSave } from '../models/SceneVersionSave';
import type { SceneVideoPrepareRequest } from '../models/SceneVideoPrepareRequest';
import type { SceneVideoRetryRequest } from '../models/SceneVideoRetryRequest';
import type { SceneVideoSaveRequest } from '../models/SceneVideoSaveRequest';
import type { SceneVideoSubmitRequest } from '../models/SceneVideoSubmitRequest';
import type { SeamReviewRequest } from '../models/SeamReviewRequest';
import type { SequenceCreate } from '../models/SequenceCreate';
import type { SequenceUpdate } from '../models/SequenceUpdate';
import type { ShootRequest } from '../models/ShootRequest';
import type { SourceResolveRequest } from '../models/SourceResolveRequest';
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
     * Scene Versions
     * 浏览已存在的场次版本，不创建默认方案。
     * @returns ApiResponse_list_SceneVersionRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneVersions({
        projectId,
        sequenceId,
    }: {
        projectId: string,
        sequenceId: string,
    }): CancelablePromise<ApiResponse_list_SceneVersionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions',
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
     * Create Scene Version
     * 显式创建空方案，历史执行记录不变。
     * @returns ApiResponse_SceneVersionRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSceneVersion({
        projectId,
        sequenceId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        requestBody: SceneVersionCreate,
    }): CancelablePromise<ApiResponse_SceneVersionRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions',
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
     * Scene Version
     * 读取具有固定原文依据的当前方案。
     * @returns ApiResponse_SceneVersionRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneVersion({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_SceneVersionRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Scene Version
     * 更新同一版本，保存并不确认设计或发起执行。
     * @returns ApiResponse_SceneVersionRead_ Successful Response
     * @throws ApiError
     */
    public static directingSaveSceneVersion({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneVersionSave,
    }): CancelablePromise<ApiResponse_SceneVersionRead_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Copy Readiness
     * 核实当前关联任务，取消请求与终态分别表达。
     * @returns ApiResponse_SceneCopyReadiness_ Successful Response
     * @throws ApiError
     */
    public static directingSceneCopyReadiness({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_SceneCopyReadiness_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/copy-readiness',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Copy Scene Version
     * 复制点击时完整内容，事务内重新核验，不预先保存原版本。
     * @returns ApiResponse_SceneVersionRead_ Successful Response
     * @throws ApiError
     */
    public static directingCopySceneVersion({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneVersionCopy,
    }): CancelablePromise<ApiResponse_SceneVersionRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/copy',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Take Library
     * 浏览同场次素材及其原生产依据，不复制或写入判断。
     * @returns ApiResponse_list_SceneTakeLibraryRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneTakeLibrary({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneTakeLibraryRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/take-library',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Take Reviews
     * 只读查看当前版本的固定素材审片记录。
     * @returns ApiResponse_list_SceneTakeReviewRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneTakeReviews({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneTakeReviewRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/take-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Scene Take Review
     * 明确复核当前已保存判断，或核实同一保存修订的既有复核记录。
     * @returns ApiResponse_SceneTakeReviewRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmSceneTakeReview({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneTakeReviewConfirm,
    }): CancelablePromise<ApiResponse_SceneTakeReviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/take-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Cut Reviews
     * 查看固定整场验收及当前适用性，不更新既有记录。
     * @returns ApiResponse_list_SceneCutReviewRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneCutReviews({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneCutReviewRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/cut-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Scene Cut Review
     * 明确记录已保存剪辑的人工结论，或核实原请求结果。
     * @returns ApiResponse_SceneCutReviewRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSceneCutReview({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneCutReviewCreate,
    }): CancelablePromise<ApiResponse_SceneCutReviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/cut-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene End Frames
     * 读取原素材实际落幅及其当前适用性。
     * @returns ApiResponse_list_SceneEndFrameRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneEndFrames({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneEndFrameRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/end-frames',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Scene End Frame
     * 显式提取保存采用的真实边界，不替换依赖或启动生成。
     * @returns ApiResponse_SceneEndFrameRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSceneEndFrame({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneEndFrameCreate,
    }): CancelablePromise<ApiResponse_SceneEndFrameRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/end-frames',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Seam Reviews
     * 查看固定接缝审查及当前适用性，不更新既有记录。
     * @returns ApiResponse_list_SceneSeamReviewRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneSeamReviews({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneSeamReviewRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/seam-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Scene Seam Review
     * 明确记录已保存真实接缝的人工结论，或核实原请求结果。
     * @returns ApiResponse_SceneSeamReviewRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSceneSeamReview({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneSeamReviewCreate,
    }): CancelablePromise<ApiResponse_SceneSeamReviewRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/seam-reviews',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
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
     * Scene Unit Design Suggestions
     * 读取本版本的单元组织任务和只读结果。
     * @returns ApiResponse_list_SceneUnitDesignSuggestionRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneUnitDesignSuggestions({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneUnitDesignSuggestionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Unit Design Suggest
     * 明确目标视频模型后冻结本次组织请求。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingSceneUnitDesignSuggest({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneUnitDesignRequest_Input,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Unit Design Preview
     * 整份核对建议；不保存或采用任何单元。
     * @returns ApiResponse_SceneUnitDesignPreview_ Successful Response
     * @throws ApiError
     */
    public static directingSceneUnitDesignPreview({
        projectId,
        sequenceId,
        versionId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        taskId: string,
        requestBody: SceneUnitDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_SceneUnitDesignPreview_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions/{task_id}/preview',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
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
     * Scene Design Suggestions
     * 读取本版本的建议任务和固定依据，历史版本也可查看。
     * @returns ApiResponse_list_SceneDesignSuggestionRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneDesignSuggestions({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneDesignSuggestionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/design-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Design Suggest
     * 冻结本版本明确选择的原文与整场设计，提交只生成建议。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingSceneDesignSuggest({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneDesignRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/design-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Design Preview
     * 重新核对当前输入与建议，不保存、不创建业务版本。
     * @returns ApiResponse_SceneDesignPreview_ Successful Response
     * @throws ApiError
     */
    public static directingSceneDesignPreview({
        projectId,
        sequenceId,
        versionId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        taskId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_SceneDesignPreview_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/design-suggestions/{task_id}/preview',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
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
     * Create Scene Delivery
     * 明确更新章节使用，重复核实不重新激活旧交付。
     * @returns ApiResponse_SceneDeliveryRead_ Successful Response
     * @throws ApiError
     */
    public static directingCreateSceneDelivery({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneDeliveryCreate,
    }): CancelablePromise<ApiResponse_SceneDeliveryRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/deliveries',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
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
    /**
     * Scene Instruction Suggest
     * 固定本次输入，仅提交当前单元的指令建议。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingSceneInstructionSuggest({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: SceneInstructionRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Instruction Suggestions
     * 读取本单元指令任务的真实状态、固定输入与结果。
     * @returns ApiResponse_list_SceneInstructionSuggestionRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneInstructionSuggestions({
        projectId,
        sequenceId,
        versionId,
        unitId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
    }): CancelablePromise<ApiResponse_list_SceneInstructionSuggestionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Instruction Preview
     * 重新核对原单元及输入后返回整份建议，不保存或生成视频。
     * @returns ApiResponse_SceneInstructionPreview_ Successful Response
     * @throws ApiError
     */
    public static directingSceneInstructionPreview({
        projectId,
        sequenceId,
        versionId,
        unitId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        taskId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_SceneInstructionPreview_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions/{task_id}/preview',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
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
     * Instruction Basis
     * 比较当前正文的已确认依据，不保存或发起生成。
     * @returns ApiResponse_InstructionBasisRead_ Successful Response
     * @throws ApiError
     */
    public static directingInstructionBasis({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_InstructionBasisRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-basis',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Confirm Instruction Basis
     * 用户明确确认已核对正文，建立独立回执；并不等同于检查通过。
     * @returns ApiResponse_InstructionBasisRead_ Successful Response
     * @throws ApiError
     */
    public static directingConfirmInstructionBasis({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: InstructionBasisConfirm,
    }): CancelablePromise<ApiResponse_InstructionBasisRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-basis/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Instruction Apply
     * 明确采用建议，返回一起应用的正文与依据；不保存版本或生成视频。
     * @returns ApiResponse_SceneInstructionApply_ Successful Response
     * @throws ApiError
     */
    public static directingSceneInstructionApply({
        projectId,
        sequenceId,
        versionId,
        unitId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        taskId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_SceneInstructionApply_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions/{task_id}/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
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
     * Instruction Check
     * 明确提交本单元检查，不自动应用结论。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingInstructionCheck({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: InstructionCheckRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Instruction Checks
     * 读取固定检查输入及真实状态，查看不构成生成授权。
     * @returns ApiResponse_list_InstructionCheckRead__ Successful Response
     * @throws ApiError
     */
    public static directingInstructionChecks({
        projectId,
        sequenceId,
        versionId,
        unitId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
    }): CancelablePromise<ApiResponse_list_InstructionCheckRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Instruction Check Compare
     * 核对当前正文与检查原输入，比较不授权生成。
     * @returns ApiResponse_InstructionCheckComparison_ Successful Response
     * @throws ApiError
     */
    public static directingInstructionCheckCompare({
        projectId,
        sequenceId,
        versionId,
        unitId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        taskId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_InstructionCheckComparison_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks/{task_id}/compare',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
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
     * Instruction Check Confirm
     * 用户明确核对检查结果后返回可绑定身份，不保存或执行视频。
     * @returns ApiResponse_InstructionCheckConfirmation_ Successful Response
     * @throws ApiError
     */
    public static directingInstructionCheckConfirm({
        projectId,
        sequenceId,
        versionId,
        unitId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        taskId: string,
        requestBody: SceneDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_InstructionCheckConfirmation_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks/{task_id}/confirm',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
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
     * Scene Video Prepare
     * 按原保存修订核验实际视频输入，不创建任务。
     * @returns ApiResponse_SceneVideoPreparation_ Successful Response
     * @throws ApiError
     */
    public static directingSceneVideoPrepare({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: SceneVideoPrepareRequest,
    }): CancelablePromise<ApiResponse_SceneVideoPreparation_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/prepare',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Video Submit
     * 按明确保存内容提交视频；历史场次仅可核实已受理的同一原请求。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingSceneVideoSubmit({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: SceneVideoSubmitRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Videos
     * 查看原单元固定执行和真实候选素材。
     * @returns ApiResponse_list_SceneVideoRead__ Successful Response
     * @throws ApiError
     */
    public static directingSceneVideos({
        projectId,
        sequenceId,
        versionId,
        unitId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
    }): CancelablePromise<ApiResponse_list_SceneVideoRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Video Save Submit
     * 保存原内容后核验并提交；历史场次仅核实既有执行，不再次保存。
     * @returns ApiResponse_SceneVideoSaveResult_ Successful Response
     * @throws ApiError
     */
    public static directingSceneVideoSaveSubmit({
        projectId,
        sequenceId,
        versionId,
        unitId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        requestBody: SceneVideoSaveRequest,
    }): CancelablePromise<ApiResponse_SceneVideoSaveResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/save-and-submit',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Take Media
     * 读取经原执行归属校验的候选播放地址和实测时长，查看不采用。
     * @returns ApiResponse_MediaRead_ Successful Response
     * @throws ApiError
     */
    public static directingSceneTakeMedia({
        projectId,
        sequenceId,
        versionId,
        unitId,
        takeId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        takeId: string,
    }): CancelablePromise<ApiResponse_MediaRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/takes/{take_id}/media',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
                'take_id': takeId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Video Retry
     * 重新核验原失败／取消执行的固定输入，创建关联原任务的新执行。
     * @returns ApiResponse_TaskAccepted_ Successful Response
     * @throws ApiError
     */
    public static directingSceneVideoRetry({
        projectId,
        sequenceId,
        versionId,
        unitId,
        executionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        unitId: string,
        executionId: string,
        requestBody: SceneVideoRetryRequest,
    }): CancelablePromise<ApiResponse_TaskAccepted_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/{execution_id}/retry',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'unit_id': unitId,
                'execution_id': executionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Submit Scene Export
     * 导出指定保存修订，响应丢失后使用同一请求核实。
     * @returns ApiResponse_SceneExportRead_ Successful Response
     * @throws ApiError
     */
    public static directingSubmitSceneExport({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneExportRequest,
    }): CancelablePromise<ApiResponse_SceneExportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/exports',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Scene Exports
     * 读取固定导出记录及成功文件入口。
     * @returns ApiResponse_list_SceneExportRead__ Successful Response
     * @throws ApiError
     */
    public static directingListSceneExports({
        projectId,
        sequenceId,
        versionId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
    }): CancelablePromise<ApiResponse_list_SceneExportRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/exports',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Retry Scene Export
     * 明确重试失败或取消的固定输入，不采用当前编辑。
     * @returns ApiResponse_SceneExportRead_ Successful Response
     * @throws ApiError
     */
    public static directingRetrySceneExport({
        projectId,
        sequenceId,
        versionId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        taskId: string,
        requestBody: SceneExportRetry,
    }): CancelablePromise<ApiResponse_SceneExportRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/exports/{task_id}/retry',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
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
     * Inspect Scene Export
     * 读取真实媒体的有效画面与缩放需求，不保存当前编辑或提交任务。
     * @returns ApiResponse_SceneExportInspection_ Successful Response
     * @throws ApiError
     */
    public static directingInspectSceneExport({
        projectId,
        sequenceId,
        versionId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        requestBody: SceneExportInspect,
    }): CancelablePromise<ApiResponse_SceneExportInspection_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/export-inspection',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Delete Scene Export File
     * 明确删除单份导出成果，保留成功事实并复用业务引用保护。
     * @returns ApiResponse_SceneExportRead_ Successful Response
     * @throws ApiError
     */
    public static directingDeleteSceneExportFile({
        projectId,
        sequenceId,
        versionId,
        taskId,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        taskId: string,
    }): CancelablePromise<ApiResponse_SceneExportRead_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/exports/{task_id}/file',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Scene Unit Design Apply
     * 明确确认后返回当前编辑内容，持久化仍走原保存入口。
     * @returns ApiResponse_SceneVersionContent_ Successful Response
     * @throws ApiError
     */
    public static directingSceneUnitDesignApply({
        projectId,
        sequenceId,
        versionId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        sequenceId: string,
        versionId: string,
        taskId: string,
        requestBody: SceneUnitDesignPreviewRequest,
    }): CancelablePromise<ApiResponse_SceneVersionContent_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions/{task_id}/apply',
            path: {
                'project_id': projectId,
                'sequence_id': sequenceId,
                'version_id': versionId,
                'task_id': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
