/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 本次视频请求**实际使用**的一个参考帧。
 *
 * 注意区分：绑定资产图片只是生成这些帧的**上游素材**，真正发给视频模型的是这里的 file_id。
 */
export type VideoPlanFrameRead = {
    /**
     * 参考模式里的位置：first / last / key
     */
    role?: string;
    /**
     * shot_frame_images.frame_type
     */
    frame_type?: string;
    file_id?: string;
    /**
     * 可用于展示/预检的地址（公网优先，其次 files 下载路由）
     */
    url?: string;
    /**
     * **供应商口径**是否可用：只有能变成 http(s):// / asset:// 引用（或该供应商接受的形态）才算 true。本地相对地址只能变成本机 data URL，对 APIMart 属于不可用
     */
    usable?: boolean;
    /**
     * 引用形态：public（公网）/ local_data_url（本地，只能变 data URL）/ missing / not_found / unreadable
     */
    ref_kind?: string;
    /**
     * 不可用时的具体原因（可直接展示给用户）
     */
    reason?: string;
};

