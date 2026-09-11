/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
/**
 * 资产图片渲染允许编辑的槽位资源；目标仅由路径唯一确定。
 */
export type AssetImagePromptRenderBody = {
    mode?: 'generate' | 'edit';
    /**
     * 局部修改的对象和目标效果
     */
    edit_instruction?: string;
    /**
     * 局部修改时明确保持的内容
     */
    preserve_instruction?: string;
    /**
     * 未传使用推荐图；空列表明确不用参考图
     */
    references?: (Array<AssetPromptReference> | null);
    /**
     * 构图
     */
    framing_instruction?: (string | null);
    /**
     * 背景
     */
    background_instruction?: (string | null);
    /**
     * 灯光
     */
    lighting_instruction?: (string | null);
    /**
     * 细节强调
     */
    visible_detail_instruction?: (string | null);
    /**
     * 排除内容
     */
    negative_prompt?: (string | null);
    /**
     * 本次附加要求，不回写资产
     */
    additional_instruction?: string;
};

