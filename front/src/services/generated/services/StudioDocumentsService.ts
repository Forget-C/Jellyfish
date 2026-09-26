/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_DocumentParseRead_ } from '../models/ApiResponse_DocumentParseRead_';
import type { Body_parse_document_api_v1_studio_documents_parse_post } from '../models/Body_parse_document_api_v1_studio_documents_parse_post';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioDocumentsService {
    /**
     * 解析剧本文档（TXT / MD / DOCX）为纯文本
     * 把上传的剧本文档解析成纯文本。
     *
     * 只读取上传内容并解析，**不写库、不上传对象存储、不调用任何外部服务**。
     * @returns ApiResponse_DocumentParseRead_ Successful Response
     * @throws ApiError
     */
    public static parseDocumentApiV1StudioDocumentsParsePost({
        formData,
    }: {
        formData: Body_parse_document_api_v1_studio_documents_parse_post,
    }): CancelablePromise<ApiResponse_DocumentParseRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/documents/parse',
            formData: formData,
            mediaType: 'multipart/form-data',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
