/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 提交一次不绑定镜头的视频实验，支持三种具名关键帧。
 */
export type VideoLabGenerateRequest = {
    /**
     * 已登记的视频模型 ID
     */
    model_id: string;
    /**
     * 所属实验会话 ID
     */
    session_id: string;
    /**
     * 最终提交给视频模型的提示词
     */
    prompt: string;
    /**
     * 视频画幅比例
     */
    ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
    /**
     * 可选首帧图片 file_id
     */
    first_frame_file_id?: (string | null);
    /**
     * 可选尾帧图片 file_id
     */
    last_frame_file_id?: (string | null);
    /**
     * 可选关键帧图片 file_id
     */
    key_frame_file_id?: (string | null);
};

