/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActorCreate } from '../models/ActorCreate';
import type { ActorUpdate } from '../models/ActorUpdate';
import type { AdoptReferenceMainRequest } from '../models/AdoptReferenceMainRequest';
import type { ApiResponse_dict_str__Any__ } from '../models/ApiResponse_dict_str__Any__';
import type { ApiResponse_EntityNameExistenceCheckResponse_ } from '../models/ApiResponse_EntityNameExistenceCheckResponse_';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_dict_str__Any___ } from '../models/ApiResponse_PaginatedData_dict_str__Any___';
import type { CharacterCreate } from '../models/CharacterCreate';
import type { CharacterUpdate } from '../models/CharacterUpdate';
import type { CostumeCreate } from '../models/CostumeCreate';
import type { CostumeUpdate } from '../models/CostumeUpdate';
import type { EntityNameExistenceCheckRequest } from '../models/EntityNameExistenceCheckRequest';
import type { ImageSourceRequest } from '../models/ImageSourceRequest';
import type { LibraryCopyRequest } from '../models/LibraryCopyRequest';
import type { PropCreate } from '../models/PropCreate';
import type { PropUpdate } from '../models/PropUpdate';
import type { SceneCreate } from '../models/SceneCreate';
import type { SceneUpdate } from '../models/SceneUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioEntitiesService {
    /**
     * 从上传图片或资产库创建独立图片来源对象
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({
        entityType,
        requestBody,
    }: {
        entityType: string,
        requestBody: ImageSourceRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/{entity_type}/image-source',
            path: {
                'entity_type': entityType,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 采用参考图的独立副本作为对象主图
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static adoptEntityReferenceMainApiV1StudioEntitiesEntityTypeEntityIdAdoptReferenceMainPost({
        entityType,
        entityId,
        requestBody,
    }: {
        entityType: string,
        entityId: string,
        requestBody: AdoptReferenceMainRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/adopt-reference-main',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 将项目对象独立复制到资产库
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static publishEntityToLibraryApiV1StudioEntitiesEntityTypeEntityIdPublishToLibraryPost({
        entityType,
        entityId,
        requestBody,
    }: {
        entityType: string,
        entityId: string,
        requestBody: LibraryCopyRequest,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/publish-to-library',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 批量检测资产名称是否存在（模糊匹配，不分页）
     * @returns ApiResponse_EntityNameExistenceCheckResponse_ Successful Response
     * @throws ApiError
     */
    public static checkEntityNamesExistenceApiV1StudioEntitiesExistenceCheckPost({
        requestBody,
    }: {
        requestBody: EntityNameExistenceCheckRequest,
    }): CancelablePromise<ApiResponse_EntityNameExistenceCheckResponse_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/existence-check',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一实体列表（分页）
     * @returns ApiResponse_PaginatedData_dict_str__Any___ Successful Response
     * @throws ApiError
     */
    public static listEntitiesApiV1StudioEntitiesEntityTypeGet({
        entityType,
        projectId,
        q,
        exactName,
        source,
        hasCover,
        style,
        visualStyle,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        entityType: string,
        /**
         * 所属项目；不传时仅查询共享资产
         */
        projectId?: (string | null),
        /**
         * 关键字，过滤 name/description
         */
        q?: (string | null),
        /**
         * 按数据库名称规则匹配同名对象
         */
        exactName?: (string | null),
        /**
         * 卡片来源，多个值取并集
         */
        source?: (Array<'created' | 'library' | 'upload' | 'project' | 'role_conversion'> | null),
        /**
         * 是否有可解析的已保存封面引用
         */
        hasCover?: (boolean | null),
        /**
         * 题材/风格（单值）
         */
        style?: (string | null),
        /**
         * 画面表现形式（单值：真人/动漫）
         */
        visualStyle?: (string | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_dict_str__Any___> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/entities/{entity_type}',
            path: {
                'entity_type': entityType,
            },
            query: {
                'project_id': projectId,
                'q': q,
                'exact_name': exactName,
                'source': source,
                'has_cover': hasCover,
                'style': style,
                'visual_style': visualStyle,
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
     * 统一创建实体
     * 解析分类请求，交由业务服务验证路径类别并处理实体。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static createEntityApiV1StudioEntitiesEntityTypePost({
        entityType,
        requestBody,
    }: {
        entityType: string,
        requestBody: (ActorCreate | CharacterCreate | SceneCreate | PropCreate | CostumeCreate),
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/{entity_type}',
            path: {
                'entity_type': entityType,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一获取实体
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static getEntityApiV1StudioEntitiesEntityTypeEntityIdGet({
        entityType,
        entityId,
    }: {
        entityType: string,
        entityId: string,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一更新实体
     * 解析分类请求，交由业务服务验证路径类别并处理实体。
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static updateEntityApiV1StudioEntitiesEntityTypeEntityIdPatch({
        entityType,
        entityId,
        requestBody,
    }: {
        entityType: string,
        entityId: string,
        requestBody: (ActorUpdate | CharacterUpdate | SceneUpdate | PropUpdate | CostumeUpdate),
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一删除实体
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteEntityApiV1StudioEntitiesEntityTypeEntityIdDelete({
        entityType,
        entityId,
    }: {
        entityType: string,
        entityId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一实体图片列表（分页）
     * @returns ApiResponse_PaginatedData_dict_str__Any___ Successful Response
     * @throws ApiError
     */
    public static listEntityImagesApiV1StudioEntitiesEntityTypeEntityIdImagesGet({
        entityType,
        entityId,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        entityType: string,
        entityId: string,
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_dict_str__Any___> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/images',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            query: {
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
     * 统一创建实体图片
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static createEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesPost({
        entityType,
        entityId,
        requestBody,
    }: {
        entityType: string,
        entityId: string,
        requestBody: Record<string, any>,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/images',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一更新实体图片
     * @returns ApiResponse_dict_str__Any__ Successful Response
     * @throws ApiError
     */
    public static updateEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdPatch({
        entityType,
        entityId,
        imageId,
        requestBody,
    }: {
        entityType: string,
        entityId: string,
        imageId: number,
        requestBody: Record<string, any>,
    }): CancelablePromise<ApiResponse_dict_str__Any__> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/images/{image_id}',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
                'image_id': imageId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 统一删除实体图片
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deleteEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdDelete({
        entityType,
        entityId,
        imageId,
    }: {
        entityType: string,
        entityId: string,
        imageId: number,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/entities/{entity_type}/{entity_id}/images/{image_id}',
            path: {
                'entity_type': entityType,
                'entity_id': entityId,
                'image_id': imageId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
