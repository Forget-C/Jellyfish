/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ActorImageRead = {
    /**
     * 资产 ID
     */
    id: string;
    /**
     * 归属项目 ID（可空=全局资产）
     */
    project_id?: (string | null);
    /**
     * 归属章节 ID（可空）
     */
    chapter_id?: (string | null);
    /**
     * 名称
     */
    name: string;
    /**
     * 描述
     */
    description?: string;
    /**
     * 缩略图 URL
     */
    thumbnail?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
    /**
     * 提示词模板 ID（可空）
     */
    prompt_template_id?: (string | null);
};

