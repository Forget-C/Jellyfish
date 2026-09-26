/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 采纳结果。
 */
export type AdoptImageRead = {
    entity_type: string;
    entity_id: string;
    image_id: number;
    file_id: string;
    /**
     * 落库后可访问地址（资产页与垫图实际使用的就是这个）
     */
    url: string;
    /**
     * 采纳时传入的来源地址，仅供溯源
     */
    source_url?: string;
    is_primary?: boolean;
    name?: string;
    /**
     * 落库地址是否**匿名公网可达**（新）：true=上游/浏览器都能匿名取到这张图；false=不可达（本机地址或对象未公开读，后续当垫图会被上游 404 拒绝）；null=未验证（演练模式，或驱动没有产出可验证的公网地址）
     */
    url_reachable?: (boolean | null);
    /**
     * 可达性验证明细（新）：http_status / probe_method / reason / how_to_fix
     */
    url_probe?: Record<string, any>;
    /**
     * 采纳过程中的如实提醒（新）：例如「已入库但匿名访问不可达」及其修法
     */
    warnings?: Array<string>;
    /**
     * 边界说明
     */
    note?: string;
};

