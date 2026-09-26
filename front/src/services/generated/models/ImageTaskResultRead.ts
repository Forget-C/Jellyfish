/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一次出图提交的结果。
 *
 * 字段口径（故障 B 的归一化，2026-09-19 真实验收）：
 *
 * - ``status`` 保留**上游原文**（``partial_failed`` 这类真话必须让用户看到），
 * 旧的 ``ok`` / ``message`` 字段一个都没删，只增不减；
 * - ``outcome`` 是**归一化口径**（新字段，调用方只需认这一组取值）：
 * ``ok`` / ``partial_failed``（图片已生成但 OSS / 落库没完成）/ ``running`` /
 * ``failed`` / ``dry_run`` / ``unknown``；
 * - ``ok`` 不再对 ``partial_failed`` 恒为 true —— 部分失败必须能被调用方识别；
 * - ``error_message`` / ``detail.error_message`` 优先装**上游真正的原因**
 * （``detail.error_message``），不再被笼统的 ``message`` 盖掉。
 */
export type ImageTaskResultRead = {
    source_task_id: string;
    source_asset_id: string;
    asset_type?: string;
    stage?: string;
    service_task_id?: string;
    /**
     * 上游原文状态（如 queued / completed / partial_failed）
     */
    status?: string;
    /**
     * 归一化口径（新）：ok / partial_failed / running / failed / dry_run / unknown；partial_failed = 图片已生成但 OSS 上传或落库没完成，绝不能当成功
     */
    outcome?: string;
    ok?: boolean;
    dry_run?: boolean;
    /**
     * 出图服务的本地/临时地址（非长期资产）
     */
    image_url?: string;
    /**
     * 长期资产地址；DRY_RUN 下为空
     */
    oss_url?: string;
    /**
     * 是否拿到了可用作长期资产的地址（新，布尔）
     */
    oss_ready?: boolean;
    /**
     * 可展示的一句话说明（失败时优先装真实原因）
     */
    message?: string;
    /**
     * 失败/部分失败的真实原因（新，优先取上游 error_message）
     */
    error_message?: string;
    /**
     * 上游报错时的 HTTP 状态码（新；取不到为空）
     */
    http_status?: (number | null);
    /**
     * 结构化明细（新）：error_message（上游原文）、http_status、oss_url、local_path、images 等；页面优先读这里的 error_message
     */
    detail?: Record<string, any>;
};

