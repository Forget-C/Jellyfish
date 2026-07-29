/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OverlayLocalizedText } from './OverlayLocalizedText';
/**
 * 后期叠加图形；时间为 episode-absolute 毫秒，shot_id 仅作关联。
 */
export type PostProductionOverlay = {
    /**
     * 稳定 ID（被 shots[].overlay_ids 引用）
     */
    overlay_id: string;
    /**
     * 叠加类型
     */
    type: 'chart_label' | 'subtitle' | 'notification' | 'fact_card' | 'disclaimer' | 'cta' | 'other';
    /**
     * 关联镜头（null 表示 episode 级）
     */
    shot_id?: (string | null);
    /**
     * 入点（episode-absolute 毫秒）
     */
    start_ms?: (number | null);
    /**
     * 出点（episode-absolute 毫秒）
     */
    end_ms?: (number | null);
    /**
     * 是否必需（可选叠加允许省略）
     */
    required?: boolean;
    /**
     * 安全区锚点
     */
    anchor?: 'lower_safe' | 'upper_safe' | 'centre' | 'prop_local';
    /**
     * 各语言文案
     */
    localized?: Array<OverlayLocalizedText>;
};

