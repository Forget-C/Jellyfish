/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_RenderedPromptSnapshot_ } from '../models/ApiResponse_RenderedPromptSnapshot_';
import type { AssetImagePromptRenderBody } from '../models/AssetImagePromptRenderBody';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationPromptsService {
    /**
     * 渲染资产图片提示词
     * 按固定资产槽位绑定 Renderer，避免请求体重复声明业务目标。
     * @returns ApiResponse_RenderedPromptSnapshot_ Successful Response
     * @throws ApiError
     */
    public static renderAssetImagePromptApiV1StudioGenerationPromptsAssetsAssetTypeAssetIdSlotsSlotIdRenderPost({
        assetType,
        assetId,
        slotId,
        requestBody,
    }: {
        assetType: 'actor' | 'character' | 'prop' | 'scene' | 'costume',
        assetId: string,
        slotId: number,
        requestBody: AssetImagePromptRenderBody,
    }): CancelablePromise<ApiResponse_RenderedPromptSnapshot_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-prompts/assets/{asset_type}/{asset_id}/slots/{slot_id}/render',
            path: {
                'asset_type': assetType,
                'asset_id': assetId,
                'slot_id': slotId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
