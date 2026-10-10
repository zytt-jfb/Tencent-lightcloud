import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bizAdminProvinces, bizAnalysisYears, bizCities, bizMe } from '@/api/biz.api';

/**
 * 经营分析共享筛选项（年度 / 省份 / 地市）全局缓存。
 *
 * 背景：概览、月度趋势、地市对比、超额清单、地市成本都会用到同一批选项数据，
 * 原先每个页面各自在挂载时拉取一次，切换页面即重复请求 3 个接口。
 *
 * 设计：
 *  - 模块级 cache + inflight Promise：整个应用生命周期内只发一次请求，
 *    并发挂载的多个组件共享同一个 inflight Promise，不会重复打接口；
 *  - Context 仅负责把已就绪的数据广播给消费方，并暴露 loading / error 状态；
 *  - 只缓存字典类选项，不缓存任何业务数据，权限过滤仍由后端按 auth.dataScope 执行。
 */
export interface AnalysisOptionProvince {
  id: string;
  name: string;
}

export interface AnalysisOptionCity {
  id: string;
  name: string;
  provinceId: string;
}

export interface AnalysisOptionsState {
  years: string[];
  provinces: AnalysisOptionProvince[];
  cities: AnalysisOptionCity[];
  /** 当前账号可访问城市 ID；null=不限制（admin/super_admin 查看全部）；非空=仅这些城市（city_user 等） */
  accessibleCityIds: string[] | null;
  loading: boolean;
  error: string | null;
}

type CachedOptions = Pick<AnalysisOptionsState, 'years' | 'provinces' | 'cities'>;

const EMPTY_STATE: AnalysisOptionsState = { years: [], provinces: [], cities: [], accessibleCityIds: null, loading: true, error: null };
const OptionsContext = createContext<AnalysisOptionsState>(EMPTY_STATE);

/** 选项只在当前登录布局生命周期内加载；不能跨账号缓存权限范围内的城市。 */
function fetchOptions(): Promise<CachedOptions> {
  return Promise.all([bizAnalysisYears(), bizAdminProvinces(), bizCities()]).then(([yearResult, provinceResult, cityResult]) => ({
    years: (yearResult.items ?? []).map(String),
    provinces: (provinceResult.items ?? []).map((p) => ({ id: p.id, name: p.name })) as AnalysisOptionProvince[],
    cities: (cityResult.items ?? []).map((c) => ({ id: c.id, name: c.name, provinceId: c.provinceId })) as AnalysisOptionCity[],
  }));
}

export function BizAnalysisOptionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisOptionsState>(EMPTY_STATE);

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchOptions().then((data) => {
      if (active) setState((prev) => ({ ...prev, ...data, loading: false, error: null }));
    }).catch(() => {
      if (active) setState({ years: [], provinces: [], cities: [], accessibleCityIds: null, loading: false, error: '筛选选项加载失败，请刷新重试' });
    });
    // 当前账号可访问城市（数据范围）随登录用户变化，每次挂载都拉取，不模块级缓存
    void bizMe()
      .then((me) => {
        if (!active) return;
        const cityIds = me.dataScope?.cityIds;
        // An empty list means the scope is not restricted to explicit cities
        // (for example super_admin/admin), rather than access to zero cities.
        setState((prev) => ({ ...prev, accessibleCityIds: cityIds?.length ? cityIds : null }));
      })
      .catch(() => { if (active) setState((prev) => ({ ...prev, accessibleCityIds: null })); });
    return () => {
      active = false;
    };
  }, []);

  return <OptionsContext.Provider value={state}>{children}</OptionsContext.Provider>;
}

export function useBizAnalysisOptions(): AnalysisOptionsState {
  return useContext(OptionsContext);
}
