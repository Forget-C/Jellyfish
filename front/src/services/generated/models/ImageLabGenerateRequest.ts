/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 提交一次独立图片实验，可携带已上传或资料库中的参考图片。
 */
export type ImageLabGenerateRequest = {
    /**
     * 已登记的图片模型 ID
     */
    model_id: string;
    /**
     * 所属实验会话 ID
     */
    session_id: string;
    /**
     * 最终提交给图片模型的提示词
     */
    prompt: string;
    /**
     * 参考图片 file_id 列表，顺序有效
     */
    images?: Array<string>;
    /**
     * 可选输出画幅比例
     */
    target_ratio?: ('16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | '3:2' | '2:3' | null);
    /**
     * 可选输出分辨率档位
     */
    resolution_profile?: ('standard' | 'high' | null);
};

