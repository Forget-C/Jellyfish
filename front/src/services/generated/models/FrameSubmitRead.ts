/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 关键帧出图结果（同进程内联执行后的真实产物与落库情况）。
 */
export type FrameSubmitRead = {
    shot_id: string;
    frame_type: string;
    /**
     * dry_run / succeeded / failed / timeout / blocked / rejected_before_submit
     */
    status?: string;
    dry_run?: boolean;
    /**
     * Jellyfish 内部任务 ID（任务中心可见）
     */
    task_id?: string;
    provider?: string;
    provider_task_id?: string;
    /**
     * 本次生成的图片地址（OSS/公网优先，可能为供应商临时地址）
     */
    image_url?: string;
    /**
     * 落库后的 files.id；未落库为空
     */
    file_id?: string;
    image_slot_id?: (number | null);
    prompt?: string;
    prompt_source?: string;
    reference_file_ids?: Array<string>;
    /**
     * 供应商/适配层的如实说明（例如垫片回传「参考图未透传」）
     */
    provider_notes?: Array<string>;
    elapsed_ms?: number;
    error?: string;
    warnings?: Array<string>;
    guard_status?: string;
    note?: string;
};

