/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StudioActorDraft } from './StudioActorDraft';
/**
 * Studio 角色草稿。
 *
 * 导入 API 未传 id 时由服务端生成；分镜详情回填时可带 character_id。
 */
export type StudioCharacterDraft = {
    /**
     * 角色 ID（已落库时回填 character_id）
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
     * 镜头内角色排序（shot_character_links.index）
     */
    index?: (number | null);
    /**
     * 角色名称（同项目内建议唯一）
     */
    name: string;
    /**
     * 角色描述
     */
    description?: string;
    /**
     * 标签（可选）
     */
    tags?: Array<string>;
    /**
     * 关联演员的身份设定，不复制到角色自身
     */
    actor?: (StudioActorDraft | null);
    /**
     * 服装名称（可选，导入时映射到 costume_id）
     */
    costume_name?: (string | null);
    /**
     * 角色常用道具名称列表（可选）
     */
    prop_names?: Array<string>;
};

