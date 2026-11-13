/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetPromptReference } from './AssetPromptReference';
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 创建演员的身份设定，不接收派生描述写入。
 */
export type ActorCreate = {
    /**
     * 演员 ID
     */
    id: string;
    /**
     * 名称
     */
    name: string;
    /**
     * 标签
     */
    tags?: Array<string>;
    /**
     * 提示词模板 ID（可空）
     */
    prompt_template_id?: (string | null);
    /**
     * 计划为该演员生成的视角图片数量（不含分镜帧）
     */
    view_count?: number;
    /**
     * 题材/风格
     */
    style?: ProjectStyle;
    /**
     * 画面表现形式（真人/动漫等）
     */
    visual_style?: ProjectVisualStyle;
    /**
     * 补充信息
     */
    supplementary_info?: string;
    /**
     * 外观年龄
     */
    age_appearance?: (string | null);
    /**
     * 性别设定
     */
    gender?: (string | null);
    /**
     * 体型
     */
    build?: (string | null);
    /**
     * 五官特征
     */
    facial_features?: (string | null);
    /**
     * 肤色
     */
    skin_tone?: (string | null);
    /**
     * 发型发色
     */
    hair?: (string | null);
    adopt_reference?: (AssetPromptReference | null);
    references?: Array<AssetPromptReference>;
    /**
     * 所属项目；不传时创建共享资产
     */
    project_id?: (string | null);
    /**
     * 可选：章节 ID
     */
    chapter_id?: (string | null);
};
