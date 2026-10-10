import * as XLSX from 'xlsx';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractCityBusinessMetricEntity } from '../contracts/contract-city-business-metric.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { CityEntity } from '../cities/city.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import { AtomicityError } from './reporting-import.service';

type CellValue = string | number | boolean | Date | null | undefined;

interface ImportErrorRow {
  row: number;
  message: string;
}

interface ParsedAllocationRow {
  excelRow: number;
  cityName: string;
  contractCode: string;
  contractName: string;
  contractAmount: number;
  rate: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
  signDate: Date | null;
  expireDate: Date | null;
  syntheticCode: boolean;
}

interface ParsedContractImport {
  rows: ParsedAllocationRow[];
  errors: ImportErrorRow[];
  totalRows: number;
}

interface ContractPreviewRow {
  contractCode: string;
  contractName: string;
  amount: number;
  rate: number;
  cityCount: number;
  status: 'previewed';
}

interface AllocationPreviewRow {
  contractCode: string;
  cityName: string;
  cityContractAmount: number;
  rate: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
}

export interface ContractImportResult {
  contracts: ContractPreviewRow[];
  allocations: AllocationPreviewRow[];
  errors: ImportErrorRow[];
  totalRows: number;
  successCount: number;
  failCount: number;
  diffSummary?: {
    overwriteCount: number;
    insertCount: number;
    contractOverwriteCount: number;
    allocationOverwriteCount: number;
  };
}

interface ContractAggregate {
  contractCode: string;
  contractName: string;
  contractAmount: number;
  rateValues: number[];
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  signDate: Date | null;
  expireDate: Date | null;
  cityNames: Set<string>;
}

interface AllocationAggregate {
  contractCode: string;
  cityName: string;
  cityContractAmount: number;
  rateValues: number[];
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
}

@Injectable()
export class ContractImportService {
  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async preview(fileBuffer: Buffer, fileName?: string | null): Promise<ContractImportResult> {
    const result = this.toResult(this.parseWorkbook(fileBuffer, fileName));
    result.diffSummary = await this.calculateDiffSummary(result);
    return result;
  }

  async execute(
    fileBuffer: Buffer,
    operatorUserId: number,
    fileName?: string | null,
  ): Promise<ContractImportResult> {
    const parsed = this.parseWorkbook(fileBuffer, fileName);
    const normalized = this.normalizeParsedRows(parsed.rows);

    await this.dataSource.transaction(async (manager) => {
      const contractRepo = manager.getRepository(ContractEntity);
      const allocationRepo = manager.getRepository(AllocationEntity);
      const metricRepo = manager.getRepository(ContractCityBusinessMetricEntity);
      const cityRepo = manager.getRepository(CityEntity);

      const cityNames = [...new Set(normalized.allocations.map((row) => row.cityName))];
      const cities = cityNames.length > 0
        ? await cityRepo.find({ where: { name: In(cityNames) } })
        : [];
      const cityMap = new Map(cities.map((city) => [city.name, city]));

      const contractCodes = normalized.contracts.map((row) => row.contractCode);
      const existingContracts = contractCodes.length > 0
        ? await contractRepo.find({ where: { contractCode: In(contractCodes) } })
        : [];
      const contractMap = new Map(existingContracts.map((contract) => [contract.contractCode, contract]));

      for (const row of normalized.contracts) {
        const existing = contractMap.get(row.contractCode);
        const contractData = {
          contractCode: row.contractCode,
          contractName: row.contractName,
          contractAmount: row.contractAmount,
          rate: row.rate,
          accumulatedOrderAmount: row.accumulatedOrderAmount,
          accumulatedInvoiceAmount: row.accumulatedInvoiceAmount,
          signDate: row.signDate,
          expireDate: row.expireDate,
          isDeleted: SoftDeleteFlag.NOT_DELETED,
          updatedBy: operatorUserId,
        };

        if (existing) {
          await contractRepo.update(existing.id, contractData);
          contractMap.set(row.contractCode, { ...existing, ...contractData });
        } else {
          const created = contractRepo.create({
            ...contractData,
            createdBy: operatorUserId,
          });
          const saved = await contractRepo.save(created);
          contractMap.set(row.contractCode, saved);
        }
      }

      const allContractIds = [...contractMap.values()].map((contract) => Number(contract.id));
      const existingAllocations = allContractIds.length > 0
        ? await allocationRepo.find({ where: { contractId: In(allContractIds) } })
        : [];
      const allocationMap = new Map(
        existingAllocations.map((allocation) => [
          this.allocationKey(Number(allocation.contractId), Number(allocation.cityId)),
          allocation,
        ]),
      );

      for (const row of normalized.allocations) {
        const contract = contractMap.get(row.contractCode);
        const city = cityMap.get(row.cityName);
        if (!contract) {
          parsed.errors.push({ row: 0, message: `合同 ${row.contractCode} 未能写入，跳过分配` });
          continue;
        }
        if (!city) {
          parsed.errors.push({ row: 0, message: `城市 ${row.cityName} 不存在，合同 ${row.contractCode} 的分配已跳过` });
          continue;
        }

        const key = this.allocationKey(Number(contract.id), Number(city.id));
        const existing = allocationMap.get(key);
        const allocationData = {
          contractId: Number(contract.id),
          cityId: Number(city.id),
          cityContractAmount: row.cityContractAmount,
          rate: row.rate,
          accumulatedOrderAmount: row.accumulatedOrderAmount,
          accumulatedInvoiceAmount: row.accumulatedInvoiceAmount,
        };

        let allocation: AllocationEntity;
        if (existing) {
          await allocationRepo.update(existing.id, allocationData);
          allocation = { ...existing, ...allocationData };
          allocationMap.set(key, allocation);
        } else {
          allocation = await allocationRepo.save(allocationRepo.create(allocationData));
          allocationMap.set(key, allocation);
        }

        const metricData = {
          contractCityAllocationId: Number(allocation.id),
          estimatedOrderAmount2026: row.estimatedOrderAmount2026,
          estimatedIncomeAmount2026: row.estimatedIncomeAmount2026,
          sourceCityName: row.cityName,
          remark: null,
        };
        const existingMetric = await metricRepo.findOne({
          where: { contractCityAllocationId: Number(allocation.id) },
        });
        if (existingMetric) {
          await metricRepo.update(existingMetric.id, metricData);
        } else {
          await metricRepo.save(metricRepo.create(metricData));
        }
      }

      // D-03（WS6-D03-2）：事务内出现任何行级错误（parsed.errors 非空）必须抛错整体回滚，
      // 禁止部分提交后 successCount 虚高（跳过行计入成功）。
      if (parsed.errors.length > 0) {
        throw new AtomicityError([...parsed.errors]);
      }
    });

    const result = this.toResult(parsed);
    result.successCount = result.allocations.length;
    result.failCount = result.errors.length;
    return result;
  }

  private parseWorkbook(fileBuffer: Buffer, fileName?: string | null): ParsedContractImport {
    const errors: ImportErrorRow[] = [];
    let workbook: XLSX.WorkBook;
    try {
      workbook = readWorkbookSafe(fileBuffer);
    } catch (error) {
      return {
        rows: [],
        errors: [{ row: 0, message: `无法读取 Excel 文件：${this.errorMessage(error)}` }],
        totalRows: 0,
      };
    }

    const sourceCity = this.inferCityName(fileName ?? '');
    const sheetName = this.findSheetName(workbook, ['合同转化', '合同信息', '合同明细']) ?? workbook.SheetNames[0];
    const sheetRows = this.getRows(workbook.Sheets[sheetName]);
    const parsedByHeader = this.parseByHeader(sheetRows, sourceCity);
    if (parsedByHeader.rows.length > 0) {
      return parsedByHeader;
    }

    errors.push(...parsedByHeader.errors);
    const fixed = this.parseFixedConversionSheet(sheetRows, sourceCity);
    return {
      rows: fixed.rows,
      errors: [...errors, ...fixed.errors],
      totalRows: sheetRows.length,
    };
  }

  private parseByHeader(rows: CellValue[][], fallbackCityName: string | null): ParsedContractImport {
    const headerIndex = rows.findIndex((row) => {
      const text = row.map((cell) => this.cellText(cell)).join('|');
      return text.includes('合同') && (text.includes('编码') || text.includes('编号')) && text.includes('名称');
    });

    if (headerIndex < 0) {
      return { rows: [], errors: [], totalRows: rows.length };
    }

    const header = rows[headerIndex].map((cell) => this.normalizeHeader(this.cellText(cell)));
    const index = {
      city: this.findHeaderIndex(header, ['地市', '城市']),
      code: this.findHeaderIndex(header, ['合同编码', '甲方合同编码', '甲方合同编号', '合同编号']),
      name: this.findHeaderIndex(header, ['合同名称']),
      amount: this.findHeaderIndex(header, ['合同金额', '合同金额万元', '合同金额含税万元']),
      rate: this.findHeaderIndex(header, ['管理费率', '管理费', '费率']),
      signDate: this.findHeaderIndex(header, ['签订日期', '签约日期']),
      expireDate: this.findHeaderIndex(header, ['到期时间', '到期日期']),
      accumulatedOrder: this.findHeaderIndex(header, ['累计订单金额', '累计订单']),
      accumulatedInvoice: this.findHeaderIndex(header, ['累计开票金额', '累计发票金额', '累计开票']),
      estimatedOrder: this.findHeaderIndex(header, ['26年预估订单', '2026年预估订单']),
      estimatedIncome: this.findHeaderIndex(header, ['26年预计收入', '2026年预计收入']),
    };

    if (index.name < 0 || (index.code < 0 && index.city < 0)) {
      return {
        rows: [],
        errors: [{ row: headerIndex + 1, message: '合同表头缺少合同名称或合同编码/地市字段' }],
        totalRows: rows.length,
      };
    }

    const amountIsWan = index.amount >= 0 && header[index.amount].includes('万元');
    const output: ParsedAllocationRow[] = [];
    const errors: ImportErrorRow[] = [];

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      const excelRow = i + 1;
      const contractName = this.cellText(row[index.name]);
      if (!contractName) continue;

      const cityName = this.normalizeCityName(this.cellText(row[index.city])) ?? fallbackCityName;
      if (!cityName) {
        errors.push({ row: excelRow, message: `合同 ${contractName} 未识别到地市` });
        continue;
      }

      const rawCode = this.cellText(row[index.code]);
      const syntheticCode = !this.isMeaningfulCode(rawCode);
      const contractCode = syntheticCode ? this.syntheticCode(cityName, contractName) : this.normalizeContractCode(rawCode);
      const amount = this.normalizeMoneyAmount(row[index.amount], amountIsWan);
      const rate = this.parseRate(row[index.rate]);

      output.push({
        excelRow,
        cityName,
        contractCode,
        contractName,
        contractAmount: this.round2(amount),
        rate,
        accumulatedOrderAmount: this.round2(this.toNumber(row[index.accumulatedOrder])),
        accumulatedInvoiceAmount: this.round2(this.toNumber(row[index.accumulatedInvoice])),
        estimatedOrderAmount2026: this.round2(this.toNumber(row[index.estimatedOrder])),
        estimatedIncomeAmount2026: this.round2(this.toNumber(row[index.estimatedIncome])),
        signDate: this.toDate(row[index.signDate]),
        expireDate: this.toDate(row[index.expireDate]),
        syntheticCode,
      });
    }

    return { rows: output, errors, totalRows: rows.length };
  }

  private parseFixedConversionSheet(rows: CellValue[][], fallbackCityName: string | null): ParsedContractImport {
    const output: ParsedAllocationRow[] = [];
    const errors: ImportErrorRow[] = [];

    for (let i = 2; i < rows.length; i += 1) {
      const row = rows[i];
      const excelRow = i + 1;
      const contractName = this.cellText(row[1]);
      if (!contractName || contractName.includes('合同名称')) continue;

      const cityName = this.normalizeCityName(this.cellText(row[0])) ?? fallbackCityName;
      if (!cityName) {
        errors.push({ row: excelRow, message: `合同 ${contractName} 未识别到地市` });
        continue;
      }

      const rawCode = this.cellText(row[2]);
      const syntheticCode = !this.isMeaningfulCode(rawCode);
      const contractCode = syntheticCode ? this.syntheticCode(cityName, contractName) : this.normalizeContractCode(rawCode);

      output.push({
        excelRow,
        cityName,
        contractCode,
        contractName,
        contractAmount: this.round2(this.normalizeMoneyAmount(row[3], true)),
        rate: this.parseRate(row[7] ?? row[4]),
        accumulatedOrderAmount: this.round2(this.toNumber(row[8])),
        accumulatedInvoiceAmount: this.round2(this.toNumber(row[9])),
        estimatedOrderAmount2026: this.round2(this.toNumber(row[10])),
        estimatedIncomeAmount2026: this.round2(this.toNumber(row[11])),
        signDate: this.toDate(row[5]),
        expireDate: this.toDate(row[6]),
        syntheticCode,
      });
    }

    return { rows: output, errors, totalRows: rows.length };
  }

  private normalizeParsedRows(rows: ParsedAllocationRow[]): {
    contracts: Array<{
      contractCode: string;
      contractName: string;
      contractAmount: number;
      rate: number;
      accumulatedOrderAmount: number;
      accumulatedInvoiceAmount: number;
      signDate: Date | null;
      expireDate: Date | null;
    }>;
    allocations: AllocationPreviewRow[];
  } {
    const contracts = new Map<string, ContractAggregate>();
    const allocations = new Map<string, AllocationAggregate>();

    for (const row of rows) {
      const existingContract = contracts.get(row.contractCode);
      if (existingContract) {
        existingContract.contractAmount = Math.max(existingContract.contractAmount, row.contractAmount);
        existingContract.accumulatedOrderAmount += row.accumulatedOrderAmount;
        existingContract.accumulatedInvoiceAmount += row.accumulatedInvoiceAmount;
        existingContract.cityNames.add(row.cityName);
        existingContract.rateValues.push(row.rate);
        existingContract.signDate = existingContract.signDate ?? row.signDate;
        existingContract.expireDate = existingContract.expireDate ?? row.expireDate;
      } else {
        contracts.set(row.contractCode, {
          contractCode: row.contractCode,
          contractName: row.contractName,
          contractAmount: row.contractAmount,
          rateValues: [row.rate],
          accumulatedOrderAmount: row.accumulatedOrderAmount,
          accumulatedInvoiceAmount: row.accumulatedInvoiceAmount,
          signDate: row.signDate,
          expireDate: row.expireDate,
          cityNames: new Set([row.cityName]),
        });
      }

      const allocationKey = `${row.contractCode}::${row.cityName}`;
      const existingAllocation = allocations.get(allocationKey);
      if (existingAllocation) {
        existingAllocation.cityContractAmount += row.contractAmount;
        existingAllocation.accumulatedOrderAmount += row.accumulatedOrderAmount;
        existingAllocation.accumulatedInvoiceAmount += row.accumulatedInvoiceAmount;
        existingAllocation.estimatedOrderAmount2026 += row.estimatedOrderAmount2026;
        existingAllocation.estimatedIncomeAmount2026 += row.estimatedIncomeAmount2026;
        existingAllocation.rateValues.push(row.rate);
      } else {
        allocations.set(allocationKey, {
          contractCode: row.contractCode,
          cityName: row.cityName,
          cityContractAmount: row.contractAmount,
          rateValues: [row.rate],
          accumulatedOrderAmount: row.accumulatedOrderAmount,
          accumulatedInvoiceAmount: row.accumulatedInvoiceAmount,
          estimatedOrderAmount2026: row.estimatedOrderAmount2026,
          estimatedIncomeAmount2026: row.estimatedIncomeAmount2026,
        });
      }
    }

    return {
      contracts: [...contracts.values()].map((row) => ({
        contractCode: row.contractCode,
        contractName: row.contractName,
        contractAmount: this.round2(row.contractAmount),
        rate: this.average(row.rateValues),
        accumulatedOrderAmount: this.round2(row.accumulatedOrderAmount),
        accumulatedInvoiceAmount: this.round2(row.accumulatedInvoiceAmount),
        signDate: row.signDate,
        expireDate: row.expireDate,
      })),
      allocations: [...allocations.values()].map((row) => ({
        contractCode: row.contractCode,
        cityName: row.cityName,
        cityContractAmount: this.round2(row.cityContractAmount),
        rate: this.average(row.rateValues),
        accumulatedOrderAmount: this.round2(row.accumulatedOrderAmount),
        accumulatedInvoiceAmount: this.round2(row.accumulatedInvoiceAmount),
        estimatedOrderAmount2026: this.round2(row.estimatedOrderAmount2026),
        estimatedIncomeAmount2026: this.round2(row.estimatedIncomeAmount2026),
      })),
    };
  }

  private toResult(parsed: ParsedContractImport): ContractImportResult {
    const normalized = this.normalizeParsedRows(parsed.rows);
    const cityCountByContract = new Map<string, number>();
    for (const row of normalized.allocations) {
      cityCountByContract.set(row.contractCode, (cityCountByContract.get(row.contractCode) ?? 0) + 1);
    }

    return {
      contracts: normalized.contracts.map((row) => ({
        contractCode: row.contractCode,
        contractName: row.contractName,
        amount: row.contractAmount,
        rate: row.rate,
        cityCount: cityCountByContract.get(row.contractCode) ?? 0,
        status: 'previewed',
      })),
      allocations: normalized.allocations,
      errors: parsed.errors,
      totalRows: parsed.totalRows,
      successCount: normalized.allocations.length,
      failCount: parsed.errors.length,
    };
  }

  private async calculateDiffSummary(result: ContractImportResult): Promise<{
    overwriteCount: number;
    insertCount: number;
    contractOverwriteCount: number;
    allocationOverwriteCount: number;
  }> {
    const contractCodes = result.contracts.map((contract) => contract.contractCode);
    const cityNames = [...new Set(result.allocations.map((allocation) => allocation.cityName))];
    const [contracts, cities] = await Promise.all([
      contractCodes.length > 0
        ? this.contractRepo.find({ where: { contractCode: In(contractCodes) } })
        : [],
      cityNames.length > 0
        ? this.cityRepo.find({ where: { name: In(cityNames) } })
        : [],
    ]);
    const contractByCode = new Map(contracts.map((contract) => [contract.contractCode, contract]));
    const cityByName = new Map(cities.map((city) => [city.name, city]));
    const contractIds = contracts.map((contract) => Number(contract.id));
    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({ where: { contractId: In(contractIds) } })
      : [];
    const allocationKeys = new Set(
      allocations.map((allocation) =>
        this.allocationKey(Number(allocation.contractId), Number(allocation.cityId)),
      ),
    );
    const contractOverwriteCount = contracts.length;
    const allocationOverwriteCount = result.allocations.filter((allocation) => {
      const contract = contractByCode.get(allocation.contractCode);
      const city = cityByName.get(allocation.cityName);
      return contract && city
        ? allocationKeys.has(this.allocationKey(Number(contract.id), Number(city.id)))
        : false;
    }).length;
    const overwriteCount = contractOverwriteCount + allocationOverwriteCount;
    const totalCount = result.contracts.length + result.allocations.length;
    return {
      overwriteCount,
      insertCount: Math.max(0, totalCount - overwriteCount),
      contractOverwriteCount,
      allocationOverwriteCount,
    };
  }

  private getRows(sheet: XLSX.WorkSheet | undefined): CellValue[][] {
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as CellValue[][];
  }

  private findSheetName(workbook: XLSX.WorkBook, keywords: string[]): string | null {
    return workbook.SheetNames.find((name) => keywords.some((keyword) => name.includes(keyword))) ?? null;
  }

  private findHeaderIndex(headers: string[], candidates: string[]): number {
    return headers.findIndex((header) => candidates.some((candidate) => header.includes(this.normalizeHeader(candidate))));
  }

  private normalizeHeader(value: string): string {
    return value.replace(/\s+/g, '').replace(/[()（）]/g, '').trim();
  }

  private cellText(value: CellValue): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
  }

  private isMeaningfulCode(code: string): boolean {
    const value = code.trim();
    return value !== '' && !['无', '暂无', '待定', '-', '—', 'null', 'NULL'].includes(value);
  }

  private normalizeCityName(value: string): string | null {
    const raw = value.replace(/[（(].*?[）)]/g, '').replace(/市$/, '').trim();
    if (!raw) return null;
    const aliases: Record<string, string> = {
      济南: '济南',
      青岛: '青岛',
      淄博: '淄博',
      枣庄: '枣庄',
      东营: '东营',
      烟台: '烟台',
      潍坊: '潍坊',
      济宁: '济宁',
      泰安: '泰安',
      威海: '威海',
      日照: '日照',
      临沂: '临沂',
      德州: '德州',
      聊城: '聊城',
      滨州: '滨州',
      菏泽: '菏泽',
    };
    return aliases[raw] ?? null;
  }

  private inferCityName(fileName: string): string | null {
    const names = ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'];
    return names.find((city) => fileName.includes(city)) ?? null;
  }

  private syntheticCode(cityName: string, contractName: string): string {
    const hash = createHash('sha1').update(`${cityName}|${contractName}`).digest('hex').slice(0, 10).toUpperCase();
    return `NO-CODE-${cityName}-${hash}`;
  }

  private normalizeContractCode(value: string): string {
    return value.replace(/\s*\/\s*/g, '/').replace(/\s+/g, '').trim();
  }

  private normalizeMoneyAmount(value: CellValue, headerIsWan: boolean): number {
    const amount = this.toNumber(value);
    if (!headerIsWan) return amount;
    // Some historical sheets label the column as 万元 but contain yuan-level values.
    return Math.abs(amount) >= 100000 ? amount : amount * 10000;
  }
  private toNumber(value: CellValue): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value).replace(/[,\s￥¥元]/g, '');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  private parseRate(value: CellValue): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') {
      return this.rateNumber(value);
    }

    const text = String(value);
    const matches = text.match(/-?\d+(?:\.\d+)?%?/g) ?? [];
    const values = matches
      .map((item) => {
        const hasPercent = item.includes('%') || text.includes('%');
        const n = Number(item.replace('%', ''));
        if (!Number.isFinite(n)) return null;
        return hasPercent ? n / 100 : this.rateNumber(n);
      })
      .filter((item): item is number => item !== null);

    return values.length > 0 ? this.average(values) : 0;
  }

  private rateNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.abs(value) > 1 ? value / 100 : value;
  }

  private average(values: number[]): number {
    const safeValues = values.filter((value) => Number.isFinite(value));
    if (safeValues.length === 0) return 0;
    return this.round4(safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length);
  }

  private toDate(value: CellValue): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value.trim().replace(/\./g, '-').replace(/\//g, '-'));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  private allocationKey(contractId: number, cityId: number): string {
    return `${contractId}:${cityId}`;
  }

  private round2(value: number): number {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  }

  private round4(value: number): number {
    return Math.round((Number.isFinite(value) ? value : 0) * 10000) / 10000;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
