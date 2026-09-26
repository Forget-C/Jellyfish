/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileTypeEnum } from './FileTypeEnum';
/**
 * 上传接口响应：文件字段**只增不删**，额外带上"这个地址上游能不能匿名取到"。
 *
 * 为什么：对象存储写入成功 ≠ 这个对象匿名可读。真实故障 A 里，本机可读、匿名访问 404
 * 的地址被当成公网地址交给了上游（上游任务 failed，原文「无法获取输入媒体 URL（404/410）」）。
 * 上传时就把结论与修法回显，用户当场能发现，而不是等下一次提交才炸。
 *
 * 不可达（``url_reachable=false``）**不影响上传本身**：文件已经落库，只是必须如实告警。
 */
export type FileUploadRead = {
    /**
     * 文件 ID
     */
    id: string;
    /**
     * 文件类型
     */
    type: FileTypeEnum;
    /**
     * 文件名/标题
     */
    name: string;
    /**
     * 缩略图 URL/路径
     */
    thumbnail?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
    /**
     * 落库后的对象地址（唯一口径：配置了 s3_public_base_url 才是公网地址；没配时为空串）
     */
    url?: string;
    /**
     * 匿名公网可达性：true=上游取得到；false=取不到（已给出中文告警与修法）；null=未验证（演练模式 / 没有拿到地址）
     */
    url_reachable?: (boolean | null);
    /**
     * 探活明细：result / http_status / method / probe_method / reason / how_to_fix
     */
    url_probe?: Record<string, any>;
    /**
     * 中文告警与修法（不可达时含「请检查 bucket 公共读或 s3_public_base_url 配置」）；不阻断上传
     */
    warnings?: Array<string>;
};

