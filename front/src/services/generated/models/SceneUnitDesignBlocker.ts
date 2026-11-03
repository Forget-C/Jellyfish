/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignSubject } from './DesignSubject';
/**
 * 稳定身份用于导航，路径只解释当前预览中的准确引用位置。
 */
export type SceneUnitDesignBlocker = {
    kind: 'design' | 'coverage';
    unit_id: string;
    coverage_item_id: string;
    path: string;
    subject?: (DesignSubject | null);
    take_kind?: ('scene_video' | 'production_plan' | null);
    take_id?: (string | null);
};
