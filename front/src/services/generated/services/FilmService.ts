/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_GenerationTaskLinkRead_ } from '../models/ApiResponse_GenerationTaskLinkRead_';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_GenerationTaskLinkRead__ } from '../models/ApiResponse_PaginatedData_GenerationTaskLinkRead__';
import type { ApiResponse_PaginatedData_TaskListItemRead__ } from '../models/ApiResponse_PaginatedData_TaskListItemRead__';
import type { ApiResponse_TaskCancelRead_ } from '../models/ApiResponse_TaskCancelRead_';
import type { ApiResponse_TaskLinkAdoptRead_ } from '../models/ApiResponse_TaskLinkAdoptRead_';
import type { ApiResponse_TaskResultRead_ } from '../models/ApiResponse_TaskResultRead_';
import type { ApiResponse_TaskStatusRead_ } from '../models/ApiResponse_TaskStatusRead_';
import type { GenerationTaskLinkCreate } from '../models/GenerationTaskLinkCreate';
import type { GenerationTaskLinkUpdate } from '../models/GenerationTaskLinkUpdate';
import type { TaskCancelRequest } from '../models/TaskCancelRequest';
import type { TaskLinkAdoptRequest } from '../models/TaskLinkAdoptRequest';
import type { TaskStatus } from '../models/TaskStatus';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FilmService {
    /**
     * 全局任务列表（任务中心）
     * @returns ApiResponse_PaginatedData_TaskListItemRead__ Successful Response
     * @throws ApiError
     */
    public static listTasksApiV1FilmTasksGet({
        statuses,
        taskKind,
        relationType,
        relationEntityId,
        recentSeconds = 300,
        page = 1,
        pageSize = 20,
    }: {
        /**
         * 按任务状态过滤，可多选
         */
        statuses?: (Array<TaskStatus> | null),
        /**
         * 按 task_kind 过滤
         */
        taskKind?: (string | null),
        /**
         * 按 relation_type 过滤
         */
        relationType?: (string | null),
        /**
         * 按 relation_entity_id 过滤
         */
        relationEntityId?: (string | null),
        /**
         * 默认返回最近结束任务的时间窗口（秒）
         */
        recentSeconds?: number,
        /**
         * 页码
         */
        page?: number,
        /**
         * 每页条数
         */
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_TaskListItemRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/tasks',
            query: {
                'statuses': statuses,
                'task_kind': taskKind,
                'relation_type': relationType,
                'relation_entity_id': relationEntityId,
                'recent_seconds': recentSeconds,
                'page': page,
                'page_size': pageSize,
            },
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
     * 请求取消任务
     * @returns ApiResponse_TaskCancelRead_ Successful Response
     * @throws ApiError
     */
    public static cancelTaskApiV1FilmTasksTaskIdCancelPost({
        taskId,
        requestBody,
    }: {
        taskId: string,
        requestBody: TaskCancelRequest,
    }): CancelablePromise<ApiResponse_TaskCancelRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/tasks/{task_id}/cancel',
            path: {
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
     * 更新任务关联的采用状态（仅可正向变更）
     * 将指定任务链接的状态设为 accepted；已采用不可改为未采用。
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
    /**
     * 生成任务关联列表（分页，支持多条件过滤）
     * @returns ApiResponse_PaginatedData_GenerationTaskLinkRead__ Successful Response
     * @throws ApiError
     */
    public static listTaskLinksApiV1FilmTaskLinksGet({
        resourceType,
        relationType,
        relationEntityId,
        status,
        taskId,
        order,
        isDesc = true,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按 resource_type 过滤
         */
        resourceType?: (string | null),
        /**
         * 按 relation_type 过滤
         */
        relationType?: (string | null),
        /**
         * 按 relation_entity_id 过滤
         */
        relationEntityId?: (string | null),
        /**
         * 按关联状态过滤（accepted/todo/rejected）
         */
        status?: (string | null),
        /**
         * 按 task_id 过滤
         */
        taskId?: (string | null),
        /**
         * 排序字段：updated_at/created_at/id/status
         */
        order?: (string | null),
        /**
         * 是否倒序；默认 true
         */
        isDesc?: boolean,
        /**
         * 页码
         */
        page?: number,
        /**
         * 每页条数
         */
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_GenerationTaskLinkRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/task-links',
            query: {
                'resource_type': resourceType,
                'relation_type': relationType,
                'relation_entity_id': relationEntityId,
                'status': status,
                'task_id': taskId,
                'order': order,
                'is_desc': isDesc,
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建生成任务关联
     * @returns ApiResponse_GenerationTaskLinkRead_ Successful Response
     * @throws ApiError
     */
    public static createTaskLinkApiV1FilmTaskLinksPost({
        requestBody,
    }: {
        requestBody: GenerationTaskLinkCreate,
    }): CancelablePromise<ApiResponse_GenerationTaskLinkRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/film/task-links',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取生成任务关联详情
     * @returns ApiResponse_GenerationTaskLinkRead_ Successful Response
     * @throws ApiError
     */
    public static getTaskLinkApiV1FilmTaskLinksLinkIdGet({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_GenerationTaskLinkRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/film/task-links/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新生成任务关联（不支持直接修改 is_adopted）
     * @returns ApiResponse_GenerationTaskLinkRead_ Successful Response
     * @throws ApiError
     */
    public static updateTaskLinkApiV1FilmTaskLinksLinkIdPatch({
        linkId,
        requestBody,
    }: {
        linkId: number,
        requestBody: GenerationTaskLinkUpdate,
    }): CancelablePromise<ApiResponse_GenerationTaskLinkRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/film/task-links/{link_id}',
            path: {
                'link_id': linkId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除生成任务关联
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteTaskLinkApiV1FilmTaskLinksLinkIdDelete({
        linkId,
    }: {
        linkId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/film/task-links/{link_id}',
            path: {
                'link_id': linkId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
