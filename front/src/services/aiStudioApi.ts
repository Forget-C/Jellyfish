import { get, post, put, del } from './http'
import type {
  Project,
  Chapter,
  Shot,
  ShotDetail,
  Asset,
  PromptTemplate,
  FileItem,
  Agent,
} from '../mocks/data'

const api = {
  projects: {
    list: () => get<Project[]>('/projects'),
    get: (id: string) => get<Project>(`/projects/${id}`),
    create: (data: Partial<Project> & { name: string }) => post<Project>('/projects', data),
    update: (id: string, data: Partial<Project>) => put<Project>(`/projects/${id}`, data),
    delete: (id: string) => del<void>(`/projects/${id}`),
  },
  chapters: {
    list: (projectId: string) => get<Chapter[]>(`/projects/${projectId}/chapters`),
  },
  shots: {
    list: (chapterId: string) => get<Shot[]>(`/chapters/${chapterId}/shots`),
    get: (shotId: string) => get<ShotDetail>(`/shots/${shotId}`),
  },
  assets: {
    list: (type?: string) =>
      get<Asset[]>(type ? `/assets?type=${type}` : '/assets'),
  },
  prompts: {
    templates: () => get<PromptTemplate[]>('/prompts/templates'),
  },
  files: {
    list: () => get<FileItem[]>('/files'),
  },
  agents: {
    list: () => get<Agent[]>('/agents'),
    get: (id: string) => get<Agent>(`/agents/${id}`),
    create: (data: Partial<Agent> & { name: string; type: Agent['type'] }) =>
      post<Agent>('/agents', data),
    update: (id: string, data: Partial<Agent>) => put<Agent>(`/agents/${id}`, data),
    delete: (id: string) => del<void>(`/agents/${id}`),
  },
}

export default api
