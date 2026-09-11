/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 服装草稿保留分类设定。
 */
export type StudioCostumeDraft = {
    /**
     * 资产 ID（已落库时回填，如 scene_id / prop_id / costume_id）
     */
    id?: (string | null);
    /**
     * 关联的文件 ID（可空）
     */
    file_id?: (string | null);
    /**
     * 缩略图下载地址（可空）
     */
    thumbnail?: (string | null);
    /**
     * 名称（同项目内建议唯一）
     */
    name: string;
    /**
     * 描述
     */
    description?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
    /**
     * 提示词模板 ID（可空）
     */
    prompt_template_id?: (string | null);
    /**
     * 计划生成视角图数量
     */
    view_count?: number;
    /**
     * 补充信息
     */
    supplementary_info?: string;
    /**
     * 服装类型
     */
    costume_type?: (string | null);
    /**
     * 款式层次
     */
    structure?: (string | null);
    /**
     * 材质
     */
    materials?: (string | null);
    /**
     * 颜色
     */
    colors?: (string | null);
    /**
     * 纹样与附属配饰
     */
    patterns_accessories?: (string | null);
};

