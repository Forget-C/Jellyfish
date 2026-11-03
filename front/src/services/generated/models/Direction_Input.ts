/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Beat_Input } from './Beat_Input';
import type { BlockingState_Input } from './BlockingState_Input';
import type { Note_Input } from './Note_Input';
import type { ShotCoverage_Input } from './ShotCoverage_Input';
import type { SpatialAnchor_Input } from './SpatialAnchor_Input';
/**
 * 总导演工作单，包括叙事、空间和覆盖约束。
 */
export type Direction_Input = {
    viewpoint: Note_Input;
    information_change: Note_Input;
    relationship_change: Note_Input;
    turning_point: Note_Input;
    immutable_facts: Array<Note_Input>;
    /**
     * 可选默认场所资产；修改不改变已选参考，单元可独立选材。
     */
    location_asset_id?: (string | null);
    spatial_basis: Note_Input;
    shootable_area: Note_Input;
    axis: Note_Input;
    scale: Note_Input;
    open_questions: Array<Note_Input>;
    control_level: Note_Input;
    beats: Array<Beat_Input>;
    anchors: Array<SpatialAnchor_Input>;
    blocking_states: Array<BlockingState_Input>;
    shots: Array<ShotCoverage_Input>;
};
