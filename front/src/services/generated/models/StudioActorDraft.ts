/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 导出演员身份设定，保留分类事实与补充信息。
 */
export type StudioActorDraft = {
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
};

