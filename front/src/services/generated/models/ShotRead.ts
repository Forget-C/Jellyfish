/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShotStatus } from './ShotStatus';
export type ShotRead = {
    /**
     * 镜头 ID
     */
    id: string;
    /**
     * 所属章节 ID
     */
    chapter_id: string;
    /**
     * 镜头序号（章节内唯一）
     */
    index: number;
    /**
     * 镜头标题
     */
    title: string;
    /**
     * 缩略图 URL/路径
     */
    thumbnail?: string;
    /**
     * 镜头状态
     */
    status?: ShotStatus;
    /**
     * 剧本摘录
     */
    script_excerpt?: string;
};

