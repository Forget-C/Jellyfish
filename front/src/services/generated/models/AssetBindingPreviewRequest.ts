/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * P2 资产绑定预览请求。
 */
export type AssetBindingPreviewRequest = {
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 集数标识（仅用于提示词）
     */
    episode_id?: string;
    /**
     * 指定镜头；为空表示整个项目
     */
    shot_ids?: Array<string>;
    /**
     * 每批镜头数
     */
    batch_size?: number;
    /**
     * 本次最多处理的镜头数
     */
    max_shots?: number;
    /**
     * 是否计算启发式第二意见用于对账
     */
    include_heuristic?: boolean;
    /**
     * 附加要求（可选）
     */
    extra_instructions?: string;
};

