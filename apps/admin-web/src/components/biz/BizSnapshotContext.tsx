import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { bizSnapshotBuild, bizSnapshotMetadata, bizSnapshotStatus } from '@/api/biz.api';
import type { BizSnapshotMetadata } from '@/api/biz.api';

interface BizSnapshotContextValue {
  /** 顶部状态栏元数据（轻量，不含分析数据） */
  meta: BizSnapshotMetadata | null;
  /** 是否正在生成（轮询中） */
  building: boolean;
  /** 刷新顶部元数据（首次进入、刷新数据、任务状态变化时调用） */
  refreshMeta: () => Promise<void>;
  /** 触发一次"更新数据"：复用同一生成任务，避免并发重复全量计算 */
  requestUpdate: () => Promise<void>;
}

const BizSnapshotContext = createContext<BizSnapshotContextValue | null>(null);

export function useBizSnapshot(): BizSnapshotContextValue {
  const ctx = useContext(BizSnapshotContext);
  if (!ctx) throw new Error('useBizSnapshot 必须在 BizSnapshotProvider 内使用');
  return ctx;
}

/**
 * 经营分析快照全局状态源（布局级）：
 *  - 所有 /biz 分析页共享同一份 meta / building 状态，避免各页面各自无休止轮询；
 *  - 轮询仅在 building 期间存在，组件卸载或任务结束时清理 timer；
 *  - 手动与定时任务共用后端幂等锁，前端只负责触发与展示。
 */
export function BizSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<BizSnapshotMetadata | null>(null);
  const [building, setBuilding] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const buildingRef = useRef(false);

  const refreshMeta = useCallback(async () => {
    try {
      const m = await bizSnapshotMetadata();
      setMeta(m);
    } catch {
      // 忽略：顶部状态栏不应因元数据拉取失败而打断页面
    }
  }, []);

  const poll = useCallback(
    async (runId: string) => {
      try {
        const res = await bizSnapshotStatus(runId);
        const run = res.run;
        if (run && run.status === 'building') {
          // 仍在生成：继续轮询（buildingRef 保证期间不重复创建任务/定时器）
          pollingRef.current = window.setTimeout(() => void poll(runId), 2000);
          return;
        }
        buildingRef.current = false;
        setBuilding(false);
        await refreshMeta();
        if (run?.status === 'failed') {
          message.error(run.errorMessage ? `数据更新失败：${run.errorMessage}` : '数据更新失败，请检查数据后重试');
        } else if (run?.status === 'ready') {
          message.success('数据更新完成');
        }
      } catch (error) {
        buildingRef.current = false;
        setBuilding(false);
        const responseMessage = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
        message.error(Array.isArray(responseMessage) ? responseMessage.join('；') : (responseMessage ?? '快照状态查询失败，请重试'));
      }
    },
    [refreshMeta],
  );

  const requestUpdate = useCallback(async () => {
    if (buildingRef.current) return; // 已有任务在跑，直接复用，不重复创建
    buildingRef.current = true;
    setBuilding(true);
    try {
      const res = await bizSnapshotBuild();
      await refreshMeta();
      if (res.status === 'building' && res.runId) {
        void poll(res.runId);
      } else {
        buildingRef.current = false;
        setBuilding(false);
        await refreshMeta();
        if (res.status === 'ready') message.info('当天数据已是最新，无需重复生成');
      }
    } catch (error) {
      buildingRef.current = false;
      setBuilding(false);
      const responseMessage = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(responseMessage) ? responseMessage.join('；') : (responseMessage ?? '数据更新失败，请稍后重试'));
    }
  }, [poll, refreshMeta]);

  useEffect(() => {
    void refreshMeta();
    return () => {
      if (pollingRef.current) window.clearTimeout(pollingRef.current);
    };
  }, [refreshMeta]);

  return (
    <BizSnapshotContext.Provider value={{ meta, building, refreshMeta, requestUpdate }}>
      {children}
    </BizSnapshotContext.Provider>
  );
}

export default BizSnapshotProvider;
