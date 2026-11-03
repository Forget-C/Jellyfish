/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyle } from './ProjectStyle';
import type { ProjectVisualStyle } from './ProjectVisualStyle';
/**
 * 局部更新演员设定，区分未传与显式清空。
 */
export type ActorUpdate = {
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
    name?: (string | null);
    tags?: (Array<string> | null);
    prompt_template_id?: (string | null);
    view_count?: (number | null);
    style?: (ProjectStyle | null);
    visual_style?: (ProjectVisualStyle | null);
};
