/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_dict_ } from '../models/ApiResponse_dict_';
import type { ApiResponse_FileDetailRead_ } from '../models/ApiResponse_FileDetailRead_';
import type { ApiResponse_FileRead_ } from '../models/ApiResponse_FileRead_';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_FileRead__ } from '../models/ApiResponse_PaginatedData_FileRead__';
import type { Body_upload_file_api_api_v1_studio_files_upload_post } from '../models/Body_upload_file_api_api_v1_studio_files_upload_post';
import type { FileUpdate } from '../models/FileUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioFilesService {
    /**
     * 文件列表（分页）
     * @returns ApiResponse_PaginatedData_FileRead__ Successful Response
     * @throws ApiError
     */
    public static listFilesApiApiV1StudioFilesGet({
        q,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
        projectId,
        chapterTitle,
        shotTitle,
        chapterId,
        usageKind,
    }: {
        /**
         * 关键字，过滤 name
         */
        q?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
        /**
         * 按 file_usages 限定项目；提供后仅返回该项目下有关联记录的文件
         */
        projectId?: (string | null),
        /**
         * 章节标题（精确匹配，与 project_id 联用）
         */
        chapterTitle?: (string | null),
        /**
         * 镜头标题（精确匹配，与 project_id 联用）
         */
        shotTitle?: (string | null),
        /**
         * 按 file_usages.chapter_id 精确过滤（与 project_id 联用；比标题稳定）
         */
        chapterId?: (string | null),
        /**
         * 按 file_usages.usage_kind 精确过滤，如 subtitle（与 project_id 联用）
         */
        usageKind?: (string | null),
    }): CancelablePromise<ApiResponse_PaginatedData_FileRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/files',
            query: {
                'q': q,
                'order': order,
                'is_desc': isDesc,
                'page': page,
                'page_size': pageSize,
                'project_id': projectId,
                'chapter_title': chapterTitle,
                'shot_title': shotTitle,
                'chapter_id': chapterId,
                'usage_kind': usageKind,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 上传文件并创建 FileItem 记录
     * @returns ApiResponse_FileRead_ Successful Response
     * @throws ApiError
     */
    public static uploadFileApiApiV1StudioFilesUploadPost({
        formData,
        name,
    }: {
        formData: Body_upload_file_api_api_v1_studio_files_upload_post,
        name?: (string | null),
    }): CancelablePromise<ApiResponse_FileRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/files/upload',
            query: {
                'name': name,
            },
            formData: formData,
            mediaType: 'multipart/form-data',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 下载文件二进制内容
     * @returns any Successful Response
     * @throws ApiError
     */
    public static downloadFileApiApiV1StudioFilesFileIdDownloadGet({
        fileId,
    }: {
        fileId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/files/{file_id}/download',
            path: {
                'file_id': fileId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取对象存储详情（head_object）
     * @returns ApiResponse_dict_ Successful Response
     * @throws ApiError
     */
    public static getFileStorageInfoApiApiV1StudioFilesFileIdStorageInfoGet({
        fileId,
    }: {
        fileId: string,
    }): CancelablePromise<ApiResponse_dict_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/files/{file_id}/storage-info',
            path: {
                'file_id': fileId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取文件详情（元信息 + file_usages）
     * @returns ApiResponse_FileDetailRead_ Successful Response
     * @throws ApiError
     */
    public static getFileDetailApiV1StudioFilesFileIdGet({
        fileId,
    }: {
        fileId: string,
    }): CancelablePromise<ApiResponse_FileDetailRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/files/{file_id}',
            path: {
                'file_id': fileId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 更新文件元信息
     * @returns ApiResponse_FileRead_ Successful Response
     * @throws ApiError
     */
    public static updateFileMetaApiV1StudioFilesFileIdPatch({
        fileId,
        requestBody,
    }: {
        fileId: string,
        requestBody: FileUpdate,
    }): CancelablePromise<ApiResponse_FileRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/files/{file_id}',
            path: {
                'file_id': fileId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除文件（记录 + 存储对象）
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteFileApiApiV1StudioFilesFileIdDelete({
        fileId,
    }: {
        fileId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/files/{file_id}',
            path: {
                'file_id': fileId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
