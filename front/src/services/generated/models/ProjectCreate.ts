/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
export type ProjectCreate = {
    /**
     * 项目名称
     */
    name: string;
    /**
     * 项目简介
     */
    description?: string;
    /**
     * 题材/风格
     */
    style: ProjectStyle;
    /**
     * 画面表现形式
     */
    visual_style?: ProjectVisualStyle;
    /**
     * 随机种子
     */
    seed?: number;
    /**
     * 是否统一风格
     */
    unify_style?: boolean;
    /**
     * 进度百分比（0-100）
     */
    progress?: number;
    /**
     * 项目级默认视频比例；分镜未覆盖时生效
     */
    default_video_ratio?: (string | null);
    /**
     * 聚合统计（JSON）
     */
    stats?: Record<string, any>;
    /**
     * 项目 ID
     */
    id: string;
};

