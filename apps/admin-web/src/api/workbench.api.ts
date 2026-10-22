import axios from 'axios';
import { getBizToken } from '@/utils/biz-auth';

/**
 * biz 系接口统一用独立 axios 实例（与 biz.api.ts / maintenance.api.ts 一致）：
 * 这里的响应不做解包，取数时显式 .data。
 * 注意不能用 @/utils/request 的全局单例——它的响应拦截器已经返回了 response.data，
 * 再取一次 .data 会得到 undefined（工作台首版就是这么崩的）。
 */
const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });
request.interceptors.request.use((config) => {
  const token = getBizToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface WorkbenchTodoDetail {
  label: string;
  value: number;
}

export interface WorkbenchTodo {
  key: string;
  label: string;
  description: string;
  /** null = 该项算不出来，页面显示「—」而不是 0 */
  count: number | null;
  level: 'danger' | 'warning' | 'info';
  link: string;
  detail: WorkbenchTodoDetail[];
}

export interface WorkbenchActivity {
  id: string;
  actionType: string;
  label: string;
  targetType: string;
  resultStatus: string;
  createdAt: string;
}

export interface WorkbenchResult {
  today: string;
  windowDays: number;
  todos: WorkbenchTodo[];
  activities: WorkbenchActivity[];
}

/** 工作台聚合数据：待办 + 最近动态，一次请求拿全 */
export async function bizWorkbench(): Promise<WorkbenchResult> {
  return (await request.get('/biz/workbench')).data as WorkbenchResult;
}

export interface WorkbenchPreferences {
  /** 待办类别；null = 从未设置过（前端按默认取前 4 个） */
  todoKeys: string[] | null;
}

/** 读取当前账号的工作台偏好（服务端存储，跨设备生效） */
export async function bizWorkbenchPreferences(): Promise<WorkbenchPreferences> {
  return (await request.get('/biz/workbench/preferences')).data as WorkbenchPreferences;
}

/** 保存待办类别偏好；传 null 表示恢复默认 */
export async function bizSetWorkbenchPreferences(todoKeys: string[] | null): Promise<WorkbenchPreferences> {
  return (await request.put('/biz/workbench/preferences', { todoKeys })).data as WorkbenchPreferences;
}
