/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DirectorCanvasGraph } from './DirectorCanvasGraph';
import type { EditCanvasGraph } from './EditCanvasGraph';
import type { InstructionCanvasGraph } from './InstructionCanvasGraph';
import type { SceneRelationshipGraph } from './SceneRelationshipGraph';
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
import type { UnitCanvasGraph } from './UnitCanvasGraph';
/**
 * 带归属与保存状态的场次版本，不向用户暴露多层草稿确认。
 */
export type SceneVersionRead = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    title: string;
    revision: number;
    source: SceneVersionSource_Output;
    content: SceneVersionContent_Output;
    relationship_graph: SceneRelationshipGraph;
    director_graph: DirectorCanvasGraph;
    unit_graph: UnitCanvasGraph;
    instruction_graph: InstructionCanvasGraph;
    edit_graph: EditCanvasGraph;
    copied_from_version_id: (string | null);
    last_save_request_id: (string | null);
    created_at: string;
    updated_at: string;
};

