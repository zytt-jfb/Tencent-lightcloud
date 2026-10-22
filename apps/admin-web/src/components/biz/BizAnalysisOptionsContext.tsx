import { BizPermissionCode } from '@/utils/biz-permission-code';
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
function fetchOptions(canReadRegions: boolean): Promise<CachedOptions> {
  // 省市字典接口（/biz/admin/provinces|cities）挂在「用户管理」权限下，地市账号请求必然 403。
  // 无权限时直接给空数组：数据结果与原来一致，但不会在落地页弹权限错误。
  const regions = canReadRegions
    ? Promise.all([bizAdminProvinces(), bizCities()])
    : Promise.resolve([{ items: [] }, { items: [] }] as [{ items: Array<{ id: string; name: string }> }, { items: Array<{ id: string; name: string; provinceId: string }> }]);
  return Promise.all([bizAnalysisYears(), regions]).then(([yearResult, [provinceResult, cityResult]]) => ({
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
    // 先取当前账号权限，再决定要不要拉省市字典；顺带把可访问城市（数据范围）带回来。
    void bizMe()
      .catch(() => null)
      .then((me) => {
        if (!active) return;
        const canReadRegions = Boolean(me && (me.roleCode === 'super_admin' || me.permissions.includes(BizPermissionCode.OPERATION_USER_MANAGE)));
        // cityIds 为空表示范围没有限定到具体城市（如 super_admin/admin），不是「零个城市」
        setState((prev) => ({
          ...prev,
          accessibleCityIds: me?.dataScope?.cityIds?.length ? me.dataScope.cityIds : null,
        }));
        return fetchOptions(canReadRegions).then((data) => {
          if (active) setState((prev) => ({ ...prev, ...data, loading: false, error: null }));
        });
      })
      .catch(() => {
        if (active) setState({ years: [], provinces: [], cities: [], accessibleCityIds: null, loading: false, error: '筛选选项加载失败，请刷新重试' });
      });
    return () => {
      active = false;
    };
  }, []);

  return <OptionsContext.Provider value={state}>{children}</OptionsContext.Provider>;
}

export function useBizAnalysisOptions(): AnalysisOptionsState {
  return useContext(OptionsContext);
}
