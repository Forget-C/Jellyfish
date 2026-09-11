/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 场景草稿保留分类设定，避免回填只剩拼装后的描述。
 */
export type StudioSceneDraft = {
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
     * 场所类型
     */
    scene_type?: (string | null);
    /**
     * 空间布局
     */
    spatial_layout?: (string | null);
    /**
     * 环境特征
     */
    environment_features?: (string | null);
    /**
     * 主要材质
     */
    materials?: (string | null);
    /**
     * 色彩
     */
    color_palette?: (string | null);
};

