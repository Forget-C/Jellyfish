/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActorCreate } from './ActorCreate';
import type { AssetPromptReference } from './AssetPromptReference';
import type { AssetViewAngle } from './AssetViewAngle';
import type { CharacterCreate } from './CharacterCreate';
import type { CostumeCreate } from './CostumeCreate';
import type { PropCreate } from './PropCreate';
import type { SceneCreate } from './SceneCreate';
/**
 * 仅预览本地对象草稿，不创建对象、图片或任务。
 */
export type DraftAssetPromptRenderBody = {
    mode?: 'generate' | 'edit';
    /**
     * 局部修改的对象和目标效果
     */
    edit_instruction?: string;
    /**
     * 局部修改时明确保持的内容
     */
    preserve_instruction?: string;
    /**
     * 未传使用推荐图；空列表明确不用参考图
     */
    references?: (Array<AssetPromptReference> | null);
    /**
     * 构图
     */
    framing_instruction?: (string | null);
    /**
     * 背景
     */
    background_instruction?: (string | null);
    /**
     * 灯光
     */
    lighting_instruction?: (string | null);
    /**
     * 细节强调
     */
    visible_detail_instruction?: (string | null);
    /**
     * 排除内容
     */
    negative_prompt?: (string | null);
    /**
     * 本次附加要求，不回写资产
     */
    additional_instruction?: string;
    asset_type: 'actor' | 'character' | 'prop' | 'scene' | 'costume';
    resource: (ActorCreate | CharacterCreate | SceneCreate | PropCreate | CostumeCreate);
    view_angle?: AssetViewAngle;
    /**
     * 局部修改预览所用的当前对象图片
     */
    image_id?: (number | null);
};
