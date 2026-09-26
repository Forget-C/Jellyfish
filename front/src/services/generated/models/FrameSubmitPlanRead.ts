/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 关键帧出图计划：提示词来源、参考图、画幅、供应商，**都不触网**。
 */
export type FrameSubmitPlanRead = {
    shot_id: string;
    frame_type: string;
    prompt?: string;
    /**
     * saved（镜头已保存的帧提示词）/ request（调用方显式传入）/ empty（两者都没有）
     */
    prompt_source?: string;
    /**
     * 实际会送出的参考图 file_id
     */
    reference_file_ids?: Array<string>;
    /**
     * 与 reference_file_ids 一一对应的**可读名**（新）：例如「角色「林晓」的定版图」/「显式指定的参考图 1」。页面文案只用这个，不要把 file_id 显示给用户。
     */
    reference_labels?: Array<string>;
    reference_count?: number;
    target_ratio?: string;
    /**
     * shot / project / default
     */
    target_ratio_source?: string;
    resolution_profile?: string;
    provider?: string;
    model_id?: string;
    model_name?: string;
    base_url?: string;
    api_key_configured?: boolean;
    /**
     * shot_frame_images 行 ID（不存在时为空，提交时会创建）
     */
    image_slot_id?: (number | null);
    warnings?: Array<string>;
    guard_status?: string;
    dry_run?: boolean;
    note?: string;
};

