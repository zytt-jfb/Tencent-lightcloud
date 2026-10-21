import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { BizAuthContext } from '../rbac/rbac.service';
import { AccessScopeService, type AccessScopeSnapshot } from '../rbac/access-scope.service';
import { CityEntity } from '../main-data/city.entity';
import { cityAliases } from '../common/org-name';
import { PerformanceBatchEntity, PerformanceRecordEntity } from './performance.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';

const months = ['score1','score2','score3','score4','score5','score6','score7','score8','score9','score10','score11','score12'] as const;
const num = (v: unknown) => v === '' || v == null ? null : Number(v);
@Injectable()
export class PerformanceService {
  constructor(@InjectRepository(PerformanceRecordEntity) private readonly repo: Repository<PerformanceRecordEntity>, @InjectRepository(PerformanceBatchEntity) private readonly batchesRepo: Repository<PerformanceBatchEntity>, @InjectRepository(BizOperationLogEntity) private readonly opLogRepo: Repository<BizOperationLogEntity>, @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>, private readonly accessScope: AccessScopeService) {}
  private ensureUpload(auth: BizAuthContext) { if (!auth.isSuperAdmin && !auth.permissionCodes.has('performance.upload.create')) throw new ForbiddenException('仅具备「绩效数据上传」权限的账号可上传绩效数据'); }
  async upload(file: Express.Multer.File, auth: BizAuthContext, assessmentYear?: number) {
    this.ensureUpload(auth); if (!file.originalname.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('仅支持 .xlsx 文件');
    const year = Number(assessmentYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('请选择有效的考核年度');
    const wb = readWorkbookSafe(file.buffer, { maxRowsPerSheet: 10000 }); if (wb.SheetNames.length !== 1) throw new BadRequestException('绩效文件必须只有一个明细 Sheet');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
    const header = (rows.shift() ?? []) as unknown[];
    const normalized = header.map((value) => String(value ?? '').replace(/\s/g, '').trim());
    const supplierIndex = normalized.indexOf('代维单位');
    const cityIndex = normalized.findIndex((value) => ['地市', '城市'].includes(value));
    const regionIndex = normalized.findIndex((value) => ['区域', '区县', '组织'].includes(value));
    const monthStart = normalized.findIndex((value) => /^1月$/.test(value));
    const monthHeaders = monthStart >= 0 ? normalized.slice(monthStart) : [];
    if (supplierIndex < 0 || regionIndex < 0 || monthStart < 0 || monthHeaders.some((value, index) => value && !/^\d+月$/.test(value))) {
      throw new BadRequestException('模板必须包含：代维单位、地市/区域、连续月份评分列');
    }
    const batch = this.batchesRepo.create({ id: randomUUID(), filename: file.originalname, uploadedBy: auth.userId, totalRows: rows.length, status: 'active' });
    try { await this.batchesRepo.save(batch); } catch (error) { throw new BadRequestException(`绩效批次写入失败：${error instanceof Error ? error.message : String(error)}`); }
    // Re-uploading replaces only the selected assessment year; other years remain available.
    try { await this.repo.createQueryBuilder().delete().from(PerformanceRecordEntity).where('assessment_year = :year', { year }).execute(); } catch (error) { throw new BadRequestException(`清理旧绩效数据失败：${error instanceof Error ? error.message : String(error)}`); }
    const entities = rows.filter(r => String(r[supplierIndex] ?? '').trim()).map(r => { const city = cityIndex >= 0 ? String(r[cityIndex] ?? '').trim() : ''; const region = String(r[regionIndex] ?? '').trim(); return this.repo.create({ id: randomUUID(), batchId: batch.id, assessmentYear: year, supplier: String(r[supplierIndex]).trim(), city, region, organization: [city, region].filter(Boolean).join(' / '), ...Object.fromEntries(months.map((key, index) => [key, num(r[index + monthStart])])) }); });
    try { await this.repo.save(entities); } catch (error) { throw new BadRequestException(`绩效明细写入失败：${error instanceof Error ? error.message : String(error)}`); }
    try {
      await this.opLogRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'performance.upload', targetType: 'performance', targetId: batch.id, resultStatus: 'success', summaryAfter: `导入绩效文件 ${file.originalname}，共 ${entities.length} 行` });
    } catch (error) {
      console.warn('[Performance] upload succeeded but operation log was not written:', error instanceof Error ? error.message : error);
    }
    return { batchId: batch.id, totalRows: entities.length };
  }
  /**
   * 数据范围：把账号绑定的地市 UUID 换成地市**名称**，再去匹配绩效表的 city 列。
   *
   * 原实现是 `p.organization LIKE '%<cityId>%'`，拿 UUID 去 LIKE 中文列，永远匹配不到，
   * 地市账号因此看不到任何数据。绩效表 city 存的是「东营」（不带市），
   * 字典里是「东营市」，所以两种写法都要试。
   *
   * 返回 null 表示不过滤；返回空数组表示无范围（查空集）。
   */
  private async scopedCityNames(auth: BizAuthContext): Promise<string[] | null> {
    if (auth.isSuperAdmin || auth.dataScope.allowAll || auth.dataScope.scopeType === 'all') return null;
    const ids = await this.accessScope.expandProvinceCities(auth.dataScope as unknown as AccessScopeSnapshot);
    if (ids === null) return null;
    const set = new Set(ids);
    if (auth.dataScope.cityId) set.add(auth.dataScope.cityId);
    if (!set.size) return [];
    const cities = await this.cityRepo.findBy({ id: In([...set]) });
    const names = new Set<string>();
    for (const city of cities) for (const alias of cityAliases(city.name)) names.add(alias);
    return [...names];
  }

  private async scoped(auth: BizAuthContext) {
    const qb = this.repo.createQueryBuilder('p').where('1 = 1');
    const cityNames = await this.scopedCityNames(auth);
    if (cityNames === null) return qb;
    if (!cityNames.length) return qb.andWhere('1 = 0');
    return qb.andWhere('p.city IN (:...scopeCityNames)', { scopeCityNames: cityNames });
  }
  async monthly(q: Record<string, string>, auth: BizAuthContext) {
    const allRows = await (await this.scoped(auth)).getMany();
    const year = Number(q.year) || new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number(q.month) || 7));
    const key = months[month - 1];
    const yearRows = allRows.filter((r) => r.assessmentYear === year);
    const valueOf = (r: PerformanceRecordEntity) => {
      const value = r[key];
      return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    };

    // 汇总 sheet: AVERAGEIFS by city + supplier, then RANK across all such rows.
    const citySupplierGroups = new Map<string, { city: string; supplier: string; values: number[] }>();
    for (const row of yearRows) {
      const score = valueOf(row);
      if (score == null) continue;
      const city = row.city ?? '';
      const id = `${city}\u0000${row.supplier}`;
      const group = citySupplierGroups.get(id) ?? { city, supplier: row.supplier, values: [] };
      group.values.push(score);
      citySupplierGroups.set(id, group);
    }
    const citySupplierAll = [...citySupplierGroups.values()].map((group) => ({
      city: group.city,
      supplier: group.supplier,
      score: group.values.reduce((sum, value) => sum + value, 0) / group.values.length,
    }));
    const rank = <T extends { score: number }>(values: T[]) => values
      .map((item) => ({ ...item, rank: 1 + values.filter((other) => other.score > item.score).length }))
      .sort((a, b) => a.rank - b.rank || b.score - a.score);
    const citySupplierItems = rank(citySupplierAll.filter((item) =>
      (!q.supplier || item.supplier === q.supplier) && (!q.city || item.city === q.city)));

    // 单位汇总 sheet averages the city/supplier summary rows for each supplier.
    const supplierGroups = new Map<string, number[]>();
    for (const item of citySupplierAll) supplierGroups.set(item.supplier, [...(supplierGroups.get(item.supplier) ?? []), item.score]);
    const supplierAll = rank([...supplierGroups].map(([supplier, values]) => ({
      supplier,
      score: values.reduce((sum, value) => sum + value, 0) / values.length,
    })));
    const items = supplierAll.filter((item) => !q.supplier || item.supplier === q.supplier);
    const scopedCitySupplier = citySupplierAll.filter((item) => !q.city || item.city === q.city);
    const companyScore = scopedCitySupplier.length
      ? scopedCitySupplier.reduce((sum, item) => sum + item.score, 0) / scopedCitySupplier.length
      : 0;
    const organizationCount = new Set(yearRows.filter((row) => !q.supplier || row.supplier === q.supplier)
      .filter((row) => !q.city || row.city === q.city).map((row) => `${row.city}|${row.region}`)).size;
    return {
      year, month, companyScore, items, citySupplierItems,
      organizations: citySupplierItems,
      organizationCount,
      suppliers: [...new Set(allRows.filter((row) => row.assessmentYear === year).map((row) => row.supplier))].sort(),
      cities: [...new Set(yearRows.map((row) => row.city).filter(Boolean))].sort(),
      years: [...new Set(allRows.map((row) => row.assessmentYear))].sort((a, b) => b - a),
    };
  }
  /** scope 文案用中文地市名，不回传 UUID（导出表头/页面说明都会用到） */
  async overview(q: Record<string, string>, auth: BizAuthContext) {
    const data = await this.monthly(q, auth);
    const cityNames = await this.scopedCityNames(auth);
    const names = cityNames === null ? null : [...new Set(cityNames.map((name) => name.replace(/市$/, '')))];
    return { ...data, scope: names === null ? '全部地市' : (names.join('、') || '无范围') };
  }
  async batches(auth: BizAuthContext) {
    // 权限由控制器上的 performance.upload.read 判定；这里不再写死「仅超管」
    try {
      return await this.batchesRepo.find({ order: { uploadedAt: 'DESC' }, take: 30 });
    } catch {
      // An empty history must not prevent the upload screen from opening when an
      // older local SQLite database has not yet received the optional batch table.
      return [];
    }
  }
  async create(body: Record<string, unknown>, auth: BizAuthContext) { this.ensureUpload(auth); const entity = this.repo.create({ id: randomUUID(), batchId: String(body.batchId ?? ''), assessmentYear: Number(body.assessmentYear ?? new Date().getFullYear()), supplier: String(body.supplier ?? ''), organization: String(body.organization ?? ''), score1: num(body.score1), score2: num(body.score2), score3: num(body.score3), score4: num(body.score4), score5: num(body.score5), score6: num(body.score6), score7: num(body.score7) }); if (!entity.supplier || !entity.organization) throw new BadRequestException('供应商和组织不能为空'); return this.repo.save(entity); }
}
