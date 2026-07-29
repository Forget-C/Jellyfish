/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 出场角色定义（叙事角色）。
 *
 * ``character_key`` 为本集内稳定引用键；``actor_key`` / ``costume_key`` 指向素材库
 * （视觉演员 / 服装），用于 Jellyfish 侧的一致性与选角映射。
 */
export type CharacterSpec = {
    /**
     * 角色键（本集内唯一，非空）
     */
    character_key: string;
    /**
     * 展示名（如 Bull）
     */
    display_name: string;
    /**
     * 叙事角色定位（如 main、chaos_agent、straight_man）
     */
    role?: string;
    /**
     * 角色描述
     */
    description?: string;
    /**
     * 对应 assets.actors 中的 actor_key（可选）
     */
    actor_key?: (string | null);
    /**
     * 对应 assets.costumes 中的 costume_key（可选）
     */
    costume_key?: (string | null);
    /**
     * 声音设定（可选）
     */
    voice_profile?: (string | null);
    /**
     * 角色连续性备注（可选）
     */
    continuity_notes?: string;
};

