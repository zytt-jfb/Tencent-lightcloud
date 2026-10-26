import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CityEntity } from '../../main-data/city.entity';
import { cityAliases } from '../../common/org-name';
import type { BizAuthContext } from '../../rbac/rbac.service';
import type { SqlParam } from '../sql/readonly-datasource';

export interface ScopePredicate {
  /** 可直接拼进 WHERE 的谓词片段（`1=1` / `city_id IN (?,?)`） */
  sql: string;
  /** 与 sql 中 `?` 一一对应的参数 */
  params: SqlParam[];
  /** 人类可读的范围描述，写进响应让用户知道自己看到的是哪个范围 */
  label: string;
  /** 降级说明：问句里指定了地市但没能定位时，告诉用户"按全部范围查了"，而不是静默 */
  notice?: string;
  /** 是否全量（超管/省级全量） */
  all: boolean;
}

/** 城市字典缓存时长：地市字典变动极少，1 分钟足够，改完等一分钟即可生效 */
const CITY_CACHE_MS = 60_000;

/**
 * 数据范围守卫（scope-guard）
 *
 * 铁律：**入参里没有「范围」这个字段**。
 * 方法签名只有 (auth, 意图声明的列)，用户输入的任何内容都不可能变成 scope 参数。
 * 这跟迁移 047 把 contract_manager 的成本授权收到 0 是同一个思路：
 * 权限只能由服务端按角色算出来，不能由调用方传进来。
 *
 * 复用现有 RBAC 的 dataScope（AccessScopeService 已把 allow/deny 解析好），
 * 这里只做三件事：
 *   1. 把「省份范围」展开成地市 id 列表（biz_performance_record 之类按地市存）；
 *   2. 按意图声明把 id 映射成地名（有些表存的是 varchar 地名）；
 *   3. 生成参数化谓词，空集合时直接拒绝而不是返回全量。
 */
@Injectable()
export class ScopeGuardService {
  private readonly logger = new Logger(ScopeGuardService.name);
  private cityCache: { at: number; rows: Array<{ id: string; name: string }> } | null = null;

  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  private async loadCities(): Promise<Array<{ id: string; name: string }>> {
    if (this.cityCache && Date.now() - this.cityCache.at < CITY_CACHE_MS) return this.cityCache.rows;
    const rows = await this.cityRepo.find({ select: { id: true, name: true } });
    this.cityCache = { at: Date.now(), rows };
    return rows;
  }

  /** 供参数抽取使用的地市名字典 */
  async cityNames(): Promise<string[]> {
    return (await this.loadCities()).map((row) => row.name).filter(Boolean);
  }

  /**
   * 解析当前账号在指定列上的可见范围。
   * @param spec.column   SQL 里的列名（可为 `a.city_id`）
   * @param spec.valueType 该列存的是 UUID 还是地名
   */
  async resolve(
    auth: BizAuthContext,
    spec: { column: string; valueType: 'city_id' | 'city_name' },
    overrideCityName?: string | null,
  ): Promise<ScopePredicate> {
    const column = spec.column;
    // 列名来自意图模板（代码常量），仍做一次严格校验，杜绝任何拼进 SQL 的可能性
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(column)) {
      throw new ForbiddenException('数据范围列名非法');
    }

    const dataScope = auth.dataScope;
    const all = auth.isSuperAdmin || dataScope?.allowAll === true || dataScope?.scopeType === 'all';

    // 先按 auth 算出「授权地市集合」（超管为空，表示全量）
    const cityIds = new Set<string>();
    for (const id of dataScope?.cityIds ?? []) if (id) cityIds.add(id);
    if (dataScope?.cityId) cityIds.add(dataScope.cityId);
    const provinceIds = dataScope?.provinceIds ?? [];
    if (provinceIds.length > 0) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(provinceIds) }, select: { id: true } });
      for (const city of cities) cityIds.add(city.id);
    }
    for (const denied of dataScope?.deniedCityIds ?? []) cityIds.delete(denied);

    // 指定地市下钻：命中授权集合才生效。
    //
    // 未命中时**不再抛 403**，而是降级到全部授权范围并附一句提示。
    // 原因：地市是从问句里按名字 includes 匹配出来的（"济南"这种 2 字短名），
    // 误命中的概率不低；把一次误匹配变成 403，用户看到的是"我没权限"，
    // 而他其实只是想问一个普通问题 —— 这比"多给了点数据 + 一句说明"糟得多。
    // 注意：这不会越权，降级后的范围仍然只是他自己的授权集合。
    let notice: string | undefined;
    if (overrideCityName && overrideCityName.trim()) {
      const requestedName = overrideCityName.trim();
      const city = await this.resolveOverrideCity(requestedName, cityIds, all);
      if (city) {
        if (spec.valueType === 'city_id') {
          return { sql: `${column} = ?`, params: [city.id], label: city.name, all: false };
        }
        // 地名列要按别名展开：「济南市」与「济南」在不同表里都出现过
        const aliases = cityAliases(city.name);
        return {
          sql: `${column} IN (${aliases.map(() => '?').join(',')})`,
          params: aliases,
          label: city.name,
          all: false,
        };
      }
      notice = `未能在你的授权范围内定位「${requestedName}」，已按你的全部授权范围查询`;
    }

    // 无下钻（或下钻未命中）：沿用原有逻辑
    if (all) {
      return { sql: '1=1', params: [], label: '全部地市', all: true, notice };
    }
    if (cityIds.size === 0) {
      // 不给「空范围就等于全量」这种默认行为 —— 那是最经典的越权漏洞
      throw new ForbiddenException('当前账号未配置数据范围，无法查询业务数据');
    }

    if (spec.valueType === 'city_id') {
      const ids = [...cityIds];
      return {
        sql: `${column} IN (${ids.map(() => '?').join(',')})`,
        params: ids,
        label: `${ids.length} 个地市`,
        all: false,
        notice,
      };
    }

    // city_name 模式：把 id 换成地名
    //
    // **必须按别名展开**：biz_cities.name 是「潍坊市」这种规范全名，而
    // biz_performance_record.city 存的是「潍坊」（导入时按表头文本落库）。
    // 只拼全名会让所有地市账号的考核查询恒定 0 行，且界面还显示「3 个地市」，
    // 用户只会以为"这个月没数据" —— 静默的错答案比报错危险得多。
    const dictionaries = await this.loadCities();
    const nameById = new Map(dictionaries.map((row) => [row.id, row.name]));
    const names = new Set<string>();
    for (const id of cityIds) {
      const name = nameById.get(id);
      if (!name) {
        this.logger.warn(`AI_SCOPE_CITY_NAME_MISSING cityId=${id}`);
        continue;
      }
      for (const alias of cityAliases(name)) names.add(alias);
    }
    if (names.size === 0) {
      throw new ForbiddenException('数据范围内没有可用的地市名称映射');
    }
    return {
      sql: `${column} IN (${[...names].map(() => '?').join(',')})`,
      params: [...names],
      // 标签用「地市数」而不是别名数，否则会显示成「6 个地市」把用户吓一跳
      label: `${new Set([...cityIds].map((id) => nameById.get(id)).filter(Boolean)).size} 个地市`,
      all: false,
      notice,
    };
  }

  /**
   * 把问句里的城市名解析成「授权集合内」的单一地市。
   * 只在 all 或授权集合命中时才返回，否则返回 null（由调用方拒绝）。
   * 命中规则：城市全名或去掉「市/地区/自治州/盟」后缀的短名精确相等，避免「济南」误中「济宁」。
   */
  private async resolveOverrideCity(
    name: string,
    authorizedIds: Set<string>,
    all: boolean,
  ): Promise<{ id: string; name: string } | null> {
    const cities = await this.loadCities();
    let best: { id: string; name: string } | null = null;
    for (const city of cities) {
      const short = city.name.replace(/(市|地区|自治州|盟)$/u, '');
      const hit = city.name === name || short === name;
      if (!hit) continue;
      // 越权过滤：非全量账号只能下钻到自己授权范围内的地市
      if (!all && !authorizedIds.has(city.id)) continue;
      if (!best || city.name.length > best.name.length) best = { id: city.id, name: city.name };
    }
    return best;
  }
}
