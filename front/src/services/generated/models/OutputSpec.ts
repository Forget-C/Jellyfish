/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SafeArea } from './SafeArea';
/**
 * 输出规格；``*_ms`` 断言永不覆盖派生时长。
 */
export type OutputSpec = {
    /**
     * 画面比例，形如 W:H
     */
    aspect_ratio?: string;
    /**
     * 渲染宽度（像素）
     */
    width?: number;
    /**
     * 渲染高度（像素）
     */
    height?: number;
    /**
     * 帧率
     */
    fps?: number;
    /**
     * 画面方向
     */
    orientation?: 'vertical' | 'horizontal' | 'square';
    /**
     * 生成footage总毫秒（可选断言）
     */
    generated_footage_ms?: (number | null);
    /**
     * 最终成片总毫秒（可选断言）
     */
    total_runtime_ms?: (number | null);
    /**
     * 安全区元数据
     */
    safe_area?: SafeArea;
};

