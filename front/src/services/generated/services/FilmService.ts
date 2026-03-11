/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_FilmEntityExtractionResult_ } from '../models/ApiResponse_FilmEntityExtractionResult_';
import type { ApiResponse_FilmShotlistResult_ } from '../models/ApiResponse_FilmShotlistResult_';
import type { ApiResponse_TaskCreated_ } from '../models/ApiResponse_TaskCreated_';
import type { ApiResponse_TaskLinkAdoptRead_ } from '../models/ApiResponse_TaskLinkAdoptRead_';
import type { ApiResponse_TaskResultRead_ } from '../models/ApiResponse_TaskResultRead_';
import type { ApiResponse_TaskStatusRead_ } from '../models/ApiResponse_TaskStatusRead_';
import type { EntityExtractRequest } from '../models/EntityExtractRequest';
import type { EntityExtractTaskRequest } from '../models/EntityExtractTaskRequest';
import type { ShotlistExtractRequest } from '../models/ShotlistExtractRequest';
import type { ShotlistExtractTaskRequest } from '../models/ShotlistExtractTaskRequest';
import type { TaskLinkAdoptRequest } from '../models/TaskLinkAdoptRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FilmService {
    /**
     * 关键信息抽取
     * 从小说文本中抽取人物、地点、道具，忠实原文、可追溯证据。
     * @returns ApiResponse_FilmEntityExtractionResult_ Successful Response
     * @throws ApiError
     */
    public static extractEntitiesApiV1FilmExtractEntitiesPost({
        requestBody,
    }: {
        requestBody: EntityExtractRequest,
    }): CancelablePromise<ApiResponse_FilmEntityExtractionResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/extract/entities',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 分镜抽取
     * 将小说片段转为可拍镜头表（景别/机位/运镜/转场/VFX）。
     * @returns ApiResponse_FilmShotlistResult_ Successful Response
     * @throws ApiError
     */
    public static extractShotlistApiV1FilmExtractShotlistPost({
        requestBody,
    }: {
        requestBody: ShotlistExtractRequest,
    }): CancelablePromise<ApiResponse_FilmShotlistResult_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/extract/shotlist',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 关键信息抽取（任务版）
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static createEntityExtractTaskApiV1FilmTasksEntitiesPost({
        requestBody,
    }: {
        requestBody: EntityExtractTaskRequest,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/tasks/entities',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 分镜抽取（任务版）
     * @returns ApiResponse_TaskCreated_ Successful Response
     * @throws ApiError
     */
    public static createShotlistTaskApiV1FilmTasksShotlistPost({
        requestBody,
    }: {
        requestBody: ShotlistExtractTaskRequest,
    }): CancelablePromise<ApiResponse_TaskCreated_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/tasks/shotlist',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 查询任务状态/进度（轮询）
     * @returns ApiResponse_TaskStatusRead_ Successful Response
     * @throws ApiError
     */
    public static getTaskStatusApiV1FilmTasksTaskIdStatusGet({
        taskId,
    }: {
        taskId: string,
    }): CancelablePromise<ApiResponse_TaskStatusRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks/{task_id}/status',
            path: {
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取任务结果
     * @returns ApiResponse_TaskResultRead_ Successful Response
     * @throws ApiError
     */
    public static getTaskResultApiV1FilmTasksTaskIdResultGet({
        taskId,
    }: {
        taskId: string,
    }): CancelablePromise<ApiResponse_TaskResultRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks/{task_id}/result',
            path: {
                'task_id': taskId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新任务关联的采用状态（仅可正向变更）
     * 将指定任务链接的 is_adopted 设为 true；已采用不可改为未采用。
     * @returns ApiResponse_TaskLinkAdoptRead_ Successful Response
     * @throws ApiError
     */
    public static adoptTaskLinkApiV1FilmTaskLinksAdoptPatch({
        requestBody,
    }: {
        requestBody: TaskLinkAdoptRequest,
    }): CancelablePromise<ApiResponse_TaskLinkAdoptRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/film/task-links/adopt',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
