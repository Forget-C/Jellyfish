/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 关键帧出图提交（受 DRY_RUN 守卫；同进程内联执行）。
 */
export type FrameSubmitRequest = {
    shot_id: string;
    /**
     * first | key | last，与 shot_frame_images.frame_type 一致
     */
    frame_type?: 'first' | 'key' | 'last';
    /**
     * 留空则用镜头里**已保存**的该帧提示词（shot_details.first/key/last_frame_prompt）
     */
    prompt?: string;
    /**
     * 显式参考图 file_id 列表；留空则用该镜头绑定资产（角色/场景/道具/服装）的定版图
     */
    images?: Array<string>;
    /**
     * 留空则按 镜头 override_video_ratio → 项目默认 → 16:9 解析
     */
    target_ratio?: string;
    resolution_profile?: 'standard' | 'high';
    model_id?: (string | null);
    /**
     * 同步等待的墙钟上限
     */
    timeout_seconds?: number;
};

