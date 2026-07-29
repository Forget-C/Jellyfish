/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DataLock } from './DataLock';
/**
 * 市场事实溯源。数值刻意为「可含占位符的字符串」（最小化 v1.1 折衷）。
 */
export type MarketData = {
    /**
     * 标的，如 BTC-USD
     */
    instrument: string;
    /**
     * 确认所用周期，如 4h
     */
    timeframe: string;
    /**
     * 被突破的阻力位
     */
    resistance_level?: (string | null);
    /**
     * 事件时价格
     */
    price?: (string | null);
    /**
     * 区间涨跌幅
     */
    price_move_pct?: (string | null);
    /**
     * 回撤幅度
     */
    pullback_pct?: (string | null);
    /**
     * 事件时间
     */
    event_timestamp_utc?: (string | null);
    /**
     * 确认K棒收盘时间
     */
    candle_close_timestamp_utc?: (string | null);
    /**
     * 数据 as-of 时间
     */
    as_of_utc?: (string | null);
    /**
     * 数据来源名称
     */
    source_name?: (string | null);
    /**
     * 公开溯源 URL（仅证据，非执行端点）
     */
    source_url?: (string | null);
    /**
     * 人工核对备注
     */
    factual_note?: (string | null);
    /**
     * 可选前高背景
     */
    ath_context?: (string | null);
    /**
     * 锁定状态
     */
    data_lock?: DataLock;
};

