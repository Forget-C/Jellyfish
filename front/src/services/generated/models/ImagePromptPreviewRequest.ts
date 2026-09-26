/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EntityProfileInput } from './EntityProfileInput';
import type { PromptCategory } from './PromptCategory';
/**
 * 图片提示词预览请求。
 *
 * ``shot_id`` 与 ``shot_text`` 至少给一个；``entity_profiles`` 为空时按
 * ``project_id``（或镜头所属项目）自动装载实体画像。
 */
export type ImagePromptPreviewRequest = {
    /**
     * 镜头 ID（用于装载镜头文本与项目实体）
     */
    shot_id?: (string | null);
    /**
     * 直接传入的镜头文本
     */
    shot_text?: (string | null);
    /**
     * 项目 ID（用于装载实体画像）
     */
    project_id?: (string | null);
    /**
     * 实体画像（覆盖自动装载）
     */
    entity_profiles?: Array<EntityProfileInput>;
    /**
     * 需要生成的槽位类别；为空时生成全部默认槽位
     */
    categories?: (Array<PromptCategory> | null);
    /**
     * 风格提示
     */
    style_hint?: string;
    /**
     * 全局负面提示词
     */
    negative_prompt?: string;
    /**
     * 附加要求（可选）
     */
    extra_instructions?: string;
};

