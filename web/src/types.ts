export type Tokens = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};
export type Session = {
  id: string;
  sourceId: number;
  title: string;
  projectId: string;
  folderId: number;
  model: string;
  created: number;
  updated: number;
  tokens: Tokens;
  models: string[];
};
export type Action = {
  id: string;
  parentId?: string;
  kind: string;
  label: string;
  detail?: string;
  input?: string;
  output?: string;
  status?: string;
  created: number;
  order: number;
};
export type Usage = { model: string; tokens: Tokens };
export type Dashboard = {
  sessions: Session[];
  summary: { sessions: number; tokens: Tokens };
  bars: {
    date: string;
    sessions: number;
    tokens: number;
    models: Record<string, number>;
  }[];
};
export type Detail = { session: Session; actions: Action[]; usage: Usage[] };
export type Options = {
  projects: { id: string; name: string }[];
  folders: { id: number; path: string }[];
  models: string[];
  sources: { id: number; name: string }[];
};
export type Status = {
  version: string;
  source: string;
  codexSource: string;
  copilotSource: string;
  kiloSource: string;
  lastImport: string;
  importError: string;
  sessions: number;
};
