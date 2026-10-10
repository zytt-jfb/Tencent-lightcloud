import { useEffect, useRef } from 'react';
import { Select, Space, Spin, Typography } from 'antd';
import { useBizAnalysisOptions } from '@/components/biz/BizAnalysisOptionsContext';

/** 统一分析筛选值：年度 + 多月 + 多省份 + 多地市（与后端 dashboard / 合同台账接口参数一致） */
export interface AnalysisFilterValue {
  year: string;
  months: string[];
  provinceIds: string[];
  cityIds: string[];
}

export const EMPTY_ANALYSIS_FILTER: AnalysisFilterValue = { year: '', months: [], provinceIds: [], cityIds: [] };

interface Props {
  value: AnalysisFilterValue;
  onChange: (value: AnalysisFilterValue) => void;
  /** 是否展示"月份"多选（趋势/概览/地市对比/超额均需要；个别页可隐藏） */
  showMonths?: boolean;
}

/**
 * 经营分析统一筛选条：年度 / 多月 / 多省份 / 多地市。
 *
 * 加载行为（修复首屏重复请求的关键）：
 *  - 选项数据统一从 BizAnalysisOptionsContext 读取（全局只请求一次，跨页面复用）；
 *  - 选项加载期间展示 loading，父页面据此推迟首次业务请求，避免在 year 为空时空跑一次；
 *  - 年度就绪后自动选择最新有效订单年度（外部已指定则尊重外部值，不覆盖用户后续选择）；
 *  - 年度列表为空时给出明确空状态，不渲染误导性的下拉/图表。
 */
export function BizAnalysisFilter({ value, onChange, showMonths = true }: Props) {
  const { years, provinces, cities, accessibleCityIds, loading, error } = useBizAnalysisOptions();

  // 年度选项就绪后自动选择最新有效订单年度；仅在未指定年度时设置一次
  useEffect(() => {
    if (loading || !years.length || value.year) return;
    onChange({ ...value, year: years[0] });
    // 仅在"选项就绪 / 年度为空"时设置，避免覆盖用户已选年度
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, years, value.year]);

  // city_user：首次就绪且尚未选择城市时，默认全选可访问城市，避免空选导致越权或无数据
  const initedAccessible = useRef(false);
  useEffect(() => {
    if (loading || initedAccessible.current) return;
    if (accessibleCityIds && accessibleCityIds.length && !value.cityIds.length) {
      initedAccessible.current = true;
      onChange({ ...value, cityIds: accessibleCityIds });
    }
  }, [loading, accessibleCityIds, value, onChange]);

  if (loading) {
    return (
      <Space wrap>
        <Spin size="small" />
        <Typography.Text type="secondary">筛选选项加载中…</Typography.Text>
      </Space>
    );
  }

  if (error) return <Typography.Text type="danger">{error}</Typography.Text>;

  if (!years.length) {
    return <Typography.Text type="secondary">暂无可选年度，请先导入订单数据后再查看分析</Typography.Text>;
  }

  const monthOptions = value.year
    ? Array.from({ length: 12 }, (_, index) => `${value.year}-${String(index + 1).padStart(2, '0')}`)
    : [];
  const baseCities = accessibleCityIds ? cities.filter((c) => accessibleCityIds.includes(c.id)) : cities;
  const visibleCities = baseCities.filter((c) => !value.provinceIds.length || value.provinceIds.includes(c.provinceId));

  return (
    <Space wrap>
      <Select
        value={value.year || undefined}
        style={{ width: 120 }}
        placeholder="年度"
        options={years.map((y) => ({ value: y, label: `${y}年` }))}
        onChange={(year) => onChange({ ...value, year, months: [] })}
      />
      {showMonths && (
        <Select
          mode="multiple" maxTagCount="responsive" allowClear
          value={value.months} placeholder="可多选月份" style={{ width: 220 }}
          options={monthOptions.map((m) => ({ value: m, label: `${m.slice(5, 7)}月` }))}
          onChange={(months) => onChange({ ...value, months })}
        />
      )}
      <Select
        mode="multiple" maxTagCount="responsive" allowClear
        value={value.provinceIds} placeholder="可多选省份" style={{ width: 220 }}
        options={provinces.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(provinceIds) => onChange({ ...value, provinceIds, cityIds: [] })}
      />
      <Select
        mode="multiple" maxTagCount="responsive" allowClear
        value={value.cityIds} placeholder="可多选地市" style={{ width: 260 }}
        options={visibleCities.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(cityIds) => onChange({ ...value, cityIds })}
      />
    </Space>
  );
}
