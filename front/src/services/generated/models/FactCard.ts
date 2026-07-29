/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FactCardLocalizedCopy } from './FactCardLocalizedCopy';
/**
 * 后期 fact card；**永远不是第五个生成镜头**。
 */
export type FactCard = {
    /**
     * 卡片时长（毫秒）
     */
    duration_ms: number;
    /**
     * 追加式才计入总时长
     */
    placement?: 'append_after_shots' | 'overlay_tail';
    /**
     * 卡面文字一律后期合成
     */
    readable_text_in_post?: boolean;
    /**
     * 各语言文案
     */
    localized: Array<FactCardLocalizedCopy>;
};

