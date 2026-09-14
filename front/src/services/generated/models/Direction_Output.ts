/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Beat_Output } from './Beat_Output';
import type { BlockingState_Output } from './BlockingState_Output';
import type { Note_Output } from './Note_Output';
import type { ShotCoverage_Output } from './ShotCoverage_Output';
import type { SpatialAnchor_Output } from './SpatialAnchor_Output';
/**
 * 总导演工作单，包括叙事、空间和覆盖约束。
 */
export type Direction_Output = {
    viewpoint: Note_Output;
    information_change: Note_Output;
    relationship_change: Note_Output;
    turning_point: Note_Output;
    immutable_facts: Array<Note_Output>;
    location_asset_id?: (string | null);
    spatial_basis: Note_Output;
    shootable_area: Note_Output;
    axis: Note_Output;
    scale: Note_Output;
    open_questions: Array<Note_Output>;
    control_level: Note_Output;
    beats: Array<Beat_Output>;
    anchors: Array<SpatialAnchor_Output>;
    blocking_states: Array<BlockingState_Output>;
    shots: Array<ShotCoverage_Output>;
};

