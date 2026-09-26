/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 把生成出来的图片采纳进资产图片槽位（断点③：刷新后仍在）。
 */
export type AdoptImageRequest = {
    /**
     * 资产类型：character / scene / prop / costume / actor
     */
    entity_type: string;
    /**
     * 资产 ID
     */
    entity_id: string;
    /**
     * 生成图片的可访问地址（不能是 DRY_RUN 占位地址）
     */
    url: string;
    /**
     * 目标图片槽位 ID；为空则复用该资产第一个槽位，没有就新建
     */
    image_id?: (number | null);
    /**
     * 是否同时设为定版主图
     */
    set_primary?: boolean;
    /**
     * 入库文件名（可空）
     */
    name?: string;
};

