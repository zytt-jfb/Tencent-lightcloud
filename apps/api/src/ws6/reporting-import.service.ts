import * as XLSX from 'xlsx';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  In,
  ObjectLiteral,
  QueryDeepPartialEntity,
  Repository,
} from 'typeorm';
import { createHash } from 'crypto';
import {
  CostCategoryCode,
  PackageStatus,
} from '@biz-reporting/shared-types';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { CityEntity } from '../cities/city.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CostMonthRowEntity } from '../packages/cost-month-row.entity';
import { MaintenanceMonthRowEntity } from '../packages/maintenance-month-row.entity';


type CellValue = string | number | boolean | Date | null | undefined;

interface ImportErrorRow {
  row: number;
  message: string;
}

/**
 * D-03：事务内出现行级错误时抛出，触发整批回滚（WS6-D03-1）。
 * errors 只读，调用方（Ws6Service）用于事务外保存 FAILED 摘要，不得继续提交部分数据。
 */
export class AtomicityError extends Error {
  constructor(readonly errors: ReadonlyArray<{ row: number; message: string }>) {
    super(`导入存在 ${errors.length} 处错误，整批回滚`);
    this.name = 'AtomicityError';
  }
}

interface ParsedMonthlyRow {
  excelRow: number;
  cityName: string;
  contractCode: string;
  contractName: string;
  monthNo: number;
  completionAmount: number;
  acceptanceAmount: number;
}

interface ParsedCostRow {
  excelRow: number;
  cityName: string;
  monthNo: number;
  costCategoryCode: CostCategoryCode;
  amount: number;
}

interface ParsedMaintenanceRow {
  excelRow: number;
  cityName: string;
  contractCode: string;
  contractName: string;
  invoiceTotalPrevYear: number;
  invoiceMonthCountPrevYear: number;
  invoiceTotalCurrentYear: number;
}

interface ParsedReportingImport {
  monthlyRows: ParsedMonthlyRow[];
  costRows: ParsedCostRow[];
  maintenanceRows: ParsedMaintenanceRow[];

  errors: ImportErrorRow[];
  totalRows: number;
  detectedCityNames: string[];
}

export enum ReportingImportScope {
  ALL = 'all',
  COST = 'cost',
}

export interface ReportingDiffSummary {
  overwriteCount: number;
  insertCount: number;
  contractOverwriteCount: number;
  costOverwriteCount: number;
  maintenanceOverwriteCount: number;
}

export interface ReportingPreviewResult {
  monthlyRows: Array<{
    cityName: string;
    contractCode: string;
    contractName: string;
    monthNo: number;
    completionAmount: number;
    acceptanceAmount: number;
    excelRow: number;
  }>;
  costRows: Array<{
    cityName: string;
    monthNo: number;
    costCategoryCode: string;
    amount: number;
    excelRow: number;
  }>;
  maintenanceRows: Array<{
    cityName: string;
    contractCode: string;
    contractName: string;
    invoiceTotalPrevYear: number;
    invoiceMonthCountPrevYear: number;
    invoiceTotalCurrentYear: number;
    excelRow: number;
  }>;
  totalRows: number;
  successCount: number;
  failCount: number;
  errors: ImportErrorRow[];
  diffSummary: ReportingDiffSummary;
  validation: {
    isValid: boolean;
    detectedCityNames: string[];
    selectedCityName: string | null;
    blockingErrorCount: number;
  };
}

export interface ReportingExecuteResult {
  successCount: number;
  failCount: number;
  errors: ImportErrorRow[];
}

const COST_CATEGORY_MAP: Array<{ keywords: string[]; code: CostCategoryCode }> = [
  { keywords: ['人工成本', '人工'], code: CostCategoryCode.LABOR },
  { keywords: ['水电费', '水电'], code: CostCategoryCode.UTILITIES },
  { keywords: ['油补', '油费'], code: CostCategoryCode.FUEL },
  { keywords: ['招待费', '招待'], code: CostCategoryCode.ENTERTAINMENT },
  { keywords: ['房租', '租金'], code: CostCategoryCode.RENT },
  { keywords: ['报销'], code: CostCategoryCode.REIMBURSEMENT },
  { keywords: ['其他'], code: CostCategoryCode.OTHER },
];

@Injectable()
export class ReportingImportService {
  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async preview(
    fileBuffer: Buffer,
    fileName?: string | null,
    forcedCityId?: number | null,
    reportYear = new Date().getFullYear(),
    scope = ReportingImportScope.ALL,
  ): Promise<ReportingPreviewResult> {
    const forcedCityName = forcedCityId ? await this.findCityName(forcedCityId) : null;
    const parsed = this.parseWorkbook(fileBuffer, fileName, forcedCityName, scope);
    const errors = [...parsed.errors, ...(await this.validateParsedImport(parsed, forcedCityName))];
    if (forcedCityId && !forcedCityName) {
      errors.push({ row: 0, message: '选择的地市不存在，不能预览' });
    }
    const diffSummary = await this.calculateDiffSummary(parsed, reportYear);
    return this.toPreview(parsed, errors, forcedCityName, diffSummary);
  }

  async execute(
    fileBuffer: Buffer,
    reportYear: number,
    operatorUserId: number,
    fileName?: string | null,
    forcedCityId?: number | null,
    scope = ReportingImportScope.ALL,
  ): Promise<ReportingExecuteResult> {
    const forcedCityName = forcedCityId ? await this.findCityName(forcedCityId) : null;
    const parsed = this.parseWorkbook(fileBuffer, fileName, forcedCityName, scope);
    const errors = [...parsed.errors, ...(await this.validateParsedImport(parsed, forcedCityName))];
    if (forcedCityId && !forcedCityName) {
      errors.push({ row: 0, message: '选择的地市不存在，不能确认导入' });
    }
    if (errors.length > 0) {
      return { successCount: 0, failCount: errors.length, errors };
    }
    let successCount = 0;

    await this.dataSource.transaction(async (manager) => {
      const cityRepo = manager.getRepository(CityEntity);
      const contractRepo = manager.getRepository(ContractEntity);
      const allocationRepo = manager.getRepository(AllocationEntity);
      const packageRepo = manager.getRepository(AnnualPackageEntity);

      const cityNames = [
        ...new Set([
          ...parsed.monthlyRows.map((row) => row.cityName),
          ...parsed.costRows.map((row) => row.cityName),
          ...parsed.maintenanceRows.map((row) => row.cityName),
        ]),
      ];
      const cities = cityNames.length > 0 ? await cityRepo.find({ where: { name: In(cityNames) } }) : [];
      const cityMap = new Map(cities.map((city) => [city.name, city]));

      const packages = new Map<string, AnnualPackageEntity>();
      const getPackage = async (city: CityEntity): Promise<AnnualPackageEntity> => {
        const key = `${city.id}:${reportYear}`;
        const cached = packages.get(key);
        if (cached) return cached;

        await this.atomicUpsert(
          manager,
          AnnualPackageEntity,
          {
            cityId: Number(city.id),
            reportYear,
            status: PackageStatus.DRAFT,
            lastUpdatedBy: operatorUserId,
            lastUpdatedAt: new Date(),
          },
          ['cityId', 'reportYear'],
          ['lastUpdatedBy', 'lastUpdatedAt'],
        );
        const packageQuery = packageRepo.createQueryBuilder('pkg')
          .where('pkg.cityId = :cityId', { cityId: Number(city.id) })
          .andWhere('pkg.reportYear = :reportYear', { reportYear });
        if (packageRepo.manager.connection.options.type === 'mysql' || packageRepo.manager.connection.options.type === 'mariadb') {
          packageQuery.setLock('pessimistic_write');
        }
        const pkg = await packageQuery.getOne();
        if (!pkg) throw new Error(`导入创建经营单元失败（city=${city.id}, year=${reportYear}）`);
        packages.set(key, pkg);
        return pkg;
      };

      const contractCodes = [...new Set([
        ...parsed.monthlyRows.map((row) => row.contractCode),
        ...parsed.maintenanceRows.map((row) => row.contractCode),
      ])];
      const contracts = contractCodes.length > 0
        ? await contractRepo.find({ where: { contractCode: In(contractCodes) } })
        : [];
      const contractMap = new Map(contracts.map((contract) => [contract.contractCode, contract]));

      const contractIds = contracts.map((contract) => Number(contract.id));
      const allocations = contractIds.length > 0
        ? await allocationRepo.find({ where: { contractId: In(contractIds) } })
        : [];
      const allocationMap = new Map(
        allocations.map((allocation) => [
          this.allocationKey(Number(allocation.contractId), Number(allocation.cityId)),
          allocation,
        ]),
      );

      for (const row of parsed.monthlyRows) {
        const city = cityMap.get(row.cityName);
        if (!city) {
          errors.push({ row: row.excelRow, message: `城市 ${row.cityName} 不存在，合同 ${row.contractCode} 已跳过` });
          continue;
        }

        const contract = contractMap.get(row.contractCode);
        if (!contract) {
          errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 不存在，请先上传合同` });
          continue;
        }

        const allocation = allocationMap.get(this.allocationKey(Number(contract.id), Number(city.id)));
        if (!allocation) {
          errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 未分配给 ${city.name}，请先上传合同分配` });
          continue;
        }

        const pkg = await getPackage(city);

        const data = {
          packageId: Number(pkg.id),
          contractId: Number(contract.id),
          contractCodeSnapshot: row.contractCode,
          contractNameSnapshot: contract.contractName || row.contractName,
          cityAllocationId: Number(allocation.id),
          monthNo: row.monthNo,
          completionAmount: row.completionAmount,
          acceptanceAmount: row.acceptanceAmount,
        };

        await this.atomicUpsert(
          manager,
          ContractMonthRowEntity,
          data,
          ['packageId', 'contractCodeSnapshot', 'monthNo'],
          ['contractId', 'contractNameSnapshot', 'cityAllocationId', 'completionAmount', 'acceptanceAmount', 'updatedAt'],
        );
        successCount += 1;
      }

      for (const row of parsed.costRows) {
        const city = cityMap.get(row.cityName);
        if (!city) {
          errors.push({ row: row.excelRow, message: `城市 ${row.cityName} 不存在，成本 ${row.costCategoryCode} 已跳过` });
          continue;
        }

        const pkg = await getPackage(city);

        const data = {
          packageId: Number(pkg.id),
          monthNo: row.monthNo,
          costCategoryCode: row.costCategoryCode,
          amount: row.amount,
        };

        await this.atomicUpsert(
          manager,
          CostMonthRowEntity,
          data,
          ['packageId', 'monthNo', 'costCategoryCode'],
          ['amount', 'updatedAt'],
        );
        successCount += 1;
      }

      for (const row of parsed.maintenanceRows) {
        const city = cityMap.get(row.cityName);
        if (!city) {
          errors.push({ row: row.excelRow, message: `地市 ${row.cityName} 不存在，综合代维已跳过` });
          continue;
        }
        const contract = contractMap.get(row.contractCode);
        if (!contract) {
          errors.push({ row: row.excelRow, message: `综合代维合同 ${row.contractCode} 不存在，请先上传合同` });
          continue;
        }
        const allocation = allocationMap.get(this.allocationKey(Number(contract.id), Number(city.id)));
        if (!allocation) {
          errors.push({ row: row.excelRow, message: `综合代维合同 ${row.contractCode} 未分配给 ${city.name}` });
          continue;
        }
        const pkg = await getPackage(city);
        const data = {
          packageId: Number(pkg.id),
          monthNo: 12,
          invoiceTotalPrevYear: row.invoiceTotalPrevYear,
          invoiceMonthCountPrevYear: row.invoiceMonthCountPrevYear,
          invoiceTotalCurrentYear: row.invoiceTotalCurrentYear,
        };
        await this.atomicUpsert(
          manager,
          MaintenanceMonthRowEntity,
          data,
          ['packageId', 'monthNo'],
          ['invoiceTotalPrevYear', 'invoiceMonthCountPrevYear', 'invoiceTotalCurrentYear', 'updatedAt'],
        );
        successCount += 1;
      }

      // D-03（WS6-D03-1）：事务内出现任何行级错误（errors 非空）必须抛错触发整体回滚，
      // 禁止部分提交后由调用方标记 FAILED（状态与数据不一致）。
      if (errors.length > 0) {
        throw new AtomicityError([...errors]);
      }
    });

    return {
      successCount,
      failCount: errors.length,
      errors,
    };
  }

  private parseWorkbook(
    fileBuffer: Buffer,
    fileName?: string | null,
    forcedCityName?: string | null,
    scope = ReportingImportScope.ALL,
  ): ParsedReportingImport {
    let workbook: XLSX.WorkBook;
    try {
      workbook = readWorkbookSafe(fileBuffer);
    } catch (error) {
      return {
        monthlyRows: [],
        costRows: [],
        maintenanceRows: [],
        errors: [{ row: 0, message: `无法读取 Excel 文件：${this.errorMessage(error)}` }],
        totalRows: 0,
        detectedCityNames: [],
      };
    }

    const fileCityName = forcedCityName ?? this.inferCityName(fileName ?? '');
    const monthlyRows: ParsedMonthlyRow[] = [];
    const costRows: ParsedCostRow[] = [];
    const maintenanceRows: ParsedMaintenanceRow[] = [];
    const errors: ImportErrorRow[] = [];
    let totalRows = 0;
    if (scope === ReportingImportScope.COST) {
      totalRows = workbook.SheetNames.reduce(
        (sum, sheetName) => sum + this.getRows(workbook.Sheets[sheetName]).length,
        0,
      );
    }

    const monthlyCities = new Set<string>();

    for (const sheetName of scope === ReportingImportScope.ALL ? workbook.SheetNames : []) {
      const rows = this.getRows(workbook.Sheets[sheetName]);
      totalRows += rows.length;
      const sheetCityName = fileCityName ?? this.inferCityName(sheetName);

      if (sheetName.includes("合同订单") || sheetName.includes("订单明细")) {
        const result = this.parseMonthlyRows(rows, sheetCityName, sheetName);
        monthlyRows.push(...result.monthlyRows);
        errors.push(...result.errors);
        result.monthlyRows.forEach((row) => monthlyCities.add(row.cityName));
      }
    }

    const inferredCostCityName = fileCityName
      ?? (monthlyCities.size === 1 ? [...monthlyCities][0] : null);

    for (const sheetName of workbook.SheetNames) {
      if (sheetName.includes("成本")) {
        const rows = this.getRows(workbook.Sheets[sheetName]);
        const sheetCityName = inferredCostCityName ?? this.inferCityName(sheetName);
        const result = this.parseCostRows(rows, sheetCityName);
        costRows.push(...result.costRows);
        errors.push(...result.errors);
      }
    }
    for (const sheetName of scope === ReportingImportScope.ALL ? workbook.SheetNames : []) {
      if (!sheetName.includes('综合代维')) continue;
      const rows = this.getRows(workbook.Sheets[sheetName]);
      const result = this.parseMaintenanceRows(rows, inferredCostCityName ?? this.inferCityName(sheetName));
      maintenanceRows.push(...result.maintenanceRows);
      errors.push(...result.errors);
    }

    const hasMonthlySheet = workbook.SheetNames.some((name) => name.includes('合同订单') || name.includes('订单明细'));
    const hasCostSheet = workbook.SheetNames.some((name) => name.includes('成本'));
    if (scope === ReportingImportScope.ALL && !hasMonthlySheet) {
      errors.push({ row: 0, message: '未找到合同订单明细表，请使用标准报表模板' });
    }
    if (scope === ReportingImportScope.ALL && !hasCostSheet) {
      errors.push({ row: 0, message: '未找到成本测算表，请使用标准报表模板' });
    }

    if (monthlyRows.length === 0 && costRows.length === 0 && workbook.SheetNames.length > 0) {
      const rows = this.getRows(workbook.Sheets[workbook.SheetNames[0]]);
      const fallbackCityName = fileCityName ?? this.inferCityName(workbook.SheetNames[0]);
      const costResult = this.parseCostRows(rows, fallbackCityName);
      costRows.push(...costResult.costRows);
      errors.push(...costResult.errors);
      if (scope === ReportingImportScope.ALL) {
        const monthlyResult = this.parseMonthlyRows(rows, fallbackCityName, workbook.SheetNames[0]);
        monthlyRows.push(...monthlyResult.monthlyRows);
        errors.push(...monthlyResult.errors);
      }
    }
    if (scope === ReportingImportScope.COST && costRows.length === 0 && errors.length === 0) {
      errors.push({ row: 0, message: '未找到可导入的成本数据，请检查成本类别和月份表头' });
    }

    return { monthlyRows, costRows, maintenanceRows, errors, totalRows, detectedCityNames: [...new Set([...monthlyRows, ...costRows, ...maintenanceRows].map((row) => row.cityName))] };
  }

  private parseMonthlyRows(
    rows: CellValue[][],
    fallbackCityName: string | null,
    sheetName: string,
  ): { monthlyRows: ParsedMonthlyRow[]; errors: ImportErrorRow[] } {
    const output: ParsedMonthlyRow[] = [];
    const headerText = rows.slice(0, 2).flat().map((cell) => this.cellText(cell)).join('|');
    if (!headerText.includes('合同名称') || !headerText.includes('合同编码') || !headerText.includes('1月') || !headerText.includes('12月')) {
      return { monthlyRows: [], errors: [{ row: 1, message: '合同订单明细表缺少合同名称、合同编码或月份表头' }] };
    }
    const errors: ImportErrorRow[] = [];

    for (let i = 2; i < rows.length; i += 1) {
      const row = rows[i];
      const excelRow = i + 1;
      const text = row.map((cell) => this.cellText(cell)).join('');
      if (!text || text.includes('合同名称') || text.includes('合同编码') || text.includes('月份')) continue;

      const shape = this.detectMonthlyShape(row, sheetName);
      if (!shape) continue;

      const rawCity = this.cellText(row[0]);
      const cityName = this.normalizeCityName(rawCity) ?? fallbackCityName;
      if (!cityName) {
        errors.push({ row: excelRow, message: '未识别到地市，合同订单行已跳过' });
        continue;
      }

      const contractName = this.cellText(row[shape.nameIndex]);
      if (!contractName) continue;

      const rawCode = this.cellText(row[shape.codeIndex]);
      const contractCode = this.isMeaningfulCode(rawCode)
        ? this.normalizeContractCode(rawCode)
        : this.syntheticCode(cityName, contractName);

      for (let monthNo = 1; monthNo <= 12; monthNo += 1) {
        const completionIndex = shape.monthStartIndex + (monthNo - 1) * 2;
        const acceptanceIndex = completionIndex + 1;
        const completionAmount = this.toNumber(row[completionIndex]);
        const acceptanceAmount = this.toNumber(row[acceptanceIndex]);
        if (completionAmount === null && acceptanceAmount === null) continue;

        output.push({
          excelRow,
          cityName,
          contractCode,
          contractName,
          monthNo,
          completionAmount: completionAmount ?? 0,
          acceptanceAmount: acceptanceAmount ?? 0,
        });
      }
    }

    return { monthlyRows: output, errors };
  }

  private parseCostRows(
    rows: CellValue[][],
    fallbackCityName: string | null,
  ): { costRows: ParsedCostRow[]; errors: ImportErrorRow[] } {
    const output: ParsedCostRow[] = [];
    const headerText = rows.slice(0, 2).flat().map((cell) => this.cellText(cell)).join('|');
    if (!headerText.includes('类别') || !headerText.includes('1月') || !headerText.includes('12月')) {
      return { costRows: [], errors: [{ row: 1, message: '成本测算表缺少类别或月份表头' }] };
    }
    const errors: ImportErrorRow[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const excelRow = i + 1;
      const categoryMatch = this.findCostCategory(row);
      if (!categoryMatch) continue;

      const cityName = this.findCityInRow(row) ?? fallbackCityName;
      if (!cityName) {
        errors.push({ row: excelRow, message: `成本 ${categoryMatch.code} 未识别到地市，已跳过` });
        continue;
      }

      for (let monthNo = 1; monthNo <= 12; monthNo += 1) {
        const amount = this.readMonthlyCost(row, categoryMatch.index, monthNo);
        if (amount === null) continue;
        output.push({
          excelRow,
          cityName,
          monthNo,
          costCategoryCode: categoryMatch.code,
          amount,
        });
      }
    }

    return { costRows: output, errors };
  }

  private parseMaintenanceRows(
    rows: CellValue[][],
    fallbackCityName: string | null,
  ): { maintenanceRows: ParsedMaintenanceRow[]; errors: ImportErrorRow[] } {
    const output: ParsedMaintenanceRow[] = [];
    const headerIndex = rows.findIndex((row) => {
      const text = row.map((cell) => this.cellText(cell)).join('|');
      return text.includes('合同编码') && text.includes('2025') && text.includes('2026');
    });
    if (headerIndex < 0) {
      return { maintenanceRows: [], errors: [{ row: 1, message: '综合代维表缺少合同编码或年度开票表头' }] };
    }

    const header = rows[headerIndex].map((cell) => this.cellText(cell));
    const cityIndex = this.findHeaderIndex(header, ['地市', '城市']);
    const nameIndex = this.findHeaderIndex(header, ['合同名称']);
    const codeIndex = this.findHeaderIndex(header, ['合同编码']);
    const previousTotalIndex = header.findIndex((cell) => cell.includes('2025') && cell.includes('累计') && cell.includes('开票'));
    const previousAverageIndex = header.findIndex((cell) => cell.includes('2025') && cell.includes('月平均') && cell.includes('开票'));
    const currentTotalIndex = header.findIndex((cell) => cell.includes('2026') && cell.includes('累计') && cell.includes('开票'));
    if (nameIndex < 0 || codeIndex < 0 || previousTotalIndex < 0 || currentTotalIndex < 0) {
      return { maintenanceRows: [], errors: [{ row: headerIndex + 1, message: '综合代维表缺少地市、合同或累计开票列' }] };
    }

    const errors: ImportErrorRow[] = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.some((cell) => this.cellText(cell))) continue;
      const excelRow = index + 1;
      const cityName = this.normalizeCityName(this.cellText(row[cityIndex])) ?? this.findCityInRow(row) ?? fallbackCityName;
      const contractName = this.cellText(row[nameIndex]);
      const contractCode = this.normalizeContractCode(this.cellText(row[codeIndex]));
      if (!cityName || !contractName || !contractCode) {
        errors.push({ row: excelRow, message: '综合代维行缺少地市、合同名称或合同编码，不能确认导入' });
        continue;
      }
      const previousTotal = this.toNumber(row[previousTotalIndex]);
      const previousAverage = previousAverageIndex >= 0 ? this.toNumber(row[previousAverageIndex]) : null;
      const currentTotal = this.toNumber(row[currentTotalIndex]);
      if (previousTotal === null || currentTotal === null) {
        errors.push({ row: excelRow, message: '综合代维行缺少年度累计开票金额，不能确认导入' });
        continue;
      }
      const invoiceMonthCountPrevYear = previousAverage && previousAverage > 0
        ? Math.max(1, Math.round(previousTotal / previousAverage))
        : 0;
      output.push({
        excelRow,
        cityName,
        contractCode,
        contractName,
        invoiceTotalPrevYear: previousTotal,
        invoiceMonthCountPrevYear,
        invoiceTotalCurrentYear: currentTotal,
      });
    }
    return { maintenanceRows: output, errors };
  }

  private findHeaderIndex(header: string[], keywords: string[]): number {
    return header.findIndex((cell) => keywords.some((keyword) => cell.includes(keyword)));
  }

  private detectMonthlyShape(row: CellValue[], sheetName: string): {
    nameIndex: number;
    codeIndex: number;
    monthStartIndex: number;
  } | null {
    const c1 = this.cellText(row[1]);
    const c2 = this.cellText(row[2]);
    const c3 = this.cellText(row[3]);
    if (!c1 && !c2 && !c3) return null;

    if (sheetName.includes('德州') || (this.looksLikeContractName(c2) && this.looksLikeContractCode(row[3]))) {
      return { nameIndex: 2, codeIndex: 3, monthStartIndex: 6 };
    }
    if (this.looksLikeContractName(c1) || this.isMeaningfulCode(c2)) {
      return { nameIndex: 1, codeIndex: 2, monthStartIndex: 5 };
    }
    return null;
  }

  private findCostCategory(row: CellValue[]): { index: number; code: CostCategoryCode } | null {
    for (let index = 0; index < Math.min(row.length, 4); index += 1) {
      const text = this.cellText(row[index]);
      if (!text) continue;
      const match = COST_CATEGORY_MAP.find((item) => item.keywords.some((keyword) => text.includes(keyword)));
      if (match) return { index, code: match.code };
    }
    return null;
  }

  private readMonthlyCost(row: CellValue[], categoryIndex: number, monthNo: number): number | null {
    const candidates = [categoryIndex + monthNo, monthNo, monthNo + 1];
    for (const index of candidates) {
      const amount = this.toNumber(row[index]);
      if (amount !== null) return amount;
    }
    return null;
  }

  private findCityInRow(row: CellValue[]): string | null {
    for (let index = 0; index < Math.min(row.length, 3); index += 1) {
      const cityName = this.normalizeCityName(this.cellText(row[index]));
      if (cityName) return cityName;
    }
    return null;
  }

  private async findCityName(cityId: number): Promise<string | null> {
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    return city?.name ?? null;
  }

  private async validateParsedImport(parsed: ParsedReportingImport, selectedCityName: string | null): Promise<ImportErrorRow[]> {
    const errors: ImportErrorRow[] = [];
    const cityNames = parsed.detectedCityNames;
    if (cityNames.length === 0 && (parsed.monthlyRows.length > 0 || parsed.costRows.length > 0 || parsed.maintenanceRows.length > 0)) {
      errors.push({ row: 0, message: '无法识别报表地市，请选择地市后重新预览' });
    }
    if (!selectedCityName && cityNames.length > 1) {
      errors.push({ row: 0, message: `文件包含多个地市（${cityNames.join('、')}），必须选择一个地市或拆分文件上传` });
    }
    if (selectedCityName) {
      const mismatch = [...parsed.monthlyRows, ...parsed.costRows, ...parsed.maintenanceRows].find((row) => row.cityName !== selectedCityName);
      if (mismatch) errors.push({ row: mismatch.excelRow, message: `所选地市为${selectedCityName}，但 Excel 第${mismatch.excelRow}行识别为${mismatch.cityName}` });
    }
    const monthlyKeys = new Set<string>();
    for (const row of parsed.monthlyRows) {
      const key = `${row.cityName}|${row.contractCode}|${row.monthNo}`;
      if (monthlyKeys.has(key)) errors.push({ row: row.excelRow, message: `合同${row.contractCode}第${row.monthNo}月重复，不能确认导入` });
      monthlyKeys.add(key);
    }
    const costKeys = new Set<string>();
    for (const row of parsed.costRows) {
      const key = `${row.cityName}|${row.monthNo}|${row.costCategoryCode}`;
      if (costKeys.has(key)) errors.push({ row: row.excelRow, message: `成本${row.costCategoryCode}第${row.monthNo}月重复，不能确认导入` });
      costKeys.add(key);
    }
    const maintenanceKeys = new Set<string>();
    for (const row of parsed.maintenanceRows) {
      const key = `${row.cityName}|${row.contractCode}`;
      if (maintenanceKeys.has(key)) errors.push({ row: row.excelRow, message: `综合代维合同${row.contractCode}重复，不能确认导入` });
      maintenanceKeys.add(key);
    }
    const cities = cityNames.length > 0 ? await this.cityRepo.find({ where: { name: In(cityNames) } }) : [];
    const cityMap = new Map(cities.map((city) => [city.name, city]));
    for (const cityName of cityNames) {
      if (!cityMap.has(cityName)) errors.push({ row: 0, message: `地市${cityName}不存在，不能确认导入` });
    }
    const contractCodes = [...new Set([
      ...parsed.monthlyRows.map((row) => row.contractCode),
      ...parsed.maintenanceRows.map((row) => row.contractCode),
    ])];
    const contracts = contractCodes.length > 0 ? await this.contractRepo.find({ where: { contractCode: In(contractCodes) } }) : [];
    const contractMap = new Map(contracts.map((contract) => [contract.contractCode, contract]));
    for (const contractCode of contractCodes) {
      if (!contractMap.has(contractCode)) {
        const row = parsed.monthlyRows.find((item) => item.contractCode === contractCode);
        errors.push({ row: row?.excelRow ?? 0, message: `合同${contractCode}不存在，请先上传合同` });
      }
    }
    const contractIds = contracts.map((contract) => Number(contract.id));
    const allocations = contractIds.length > 0 ? await this.dataSource.getRepository(AllocationEntity).find({ where: { contractId: In(contractIds) } }) : [];
    const allocationKeys = new Set(allocations.map((allocation) => this.allocationKey(Number(allocation.contractId), Number(allocation.cityId))));
    const reportedMissing = new Set<string>();
    for (const row of [...parsed.monthlyRows, ...parsed.maintenanceRows]) {
      const contract = contractMap.get(row.contractCode);
      const city = cityMap.get(row.cityName);
      if (contract && city) {
        const key = this.allocationKey(Number(contract.id), Number(city.id));
        if (!allocationKeys.has(key) && !reportedMissing.has(key)) {
          errors.push({ row: row.excelRow, message: `合同${row.contractCode}未分配给${row.cityName}，不能确认导入` });
          reportedMissing.add(key);
        }
      }
    }
    return errors;
  }

  private async calculateDiffSummary(
    parsed: ParsedReportingImport,
    reportYear: number,
  ): Promise<ReportingDiffSummary> {
    const cities = parsed.detectedCityNames.length > 0
      ? await this.cityRepo.find({ where: { name: In(parsed.detectedCityNames) } })
      : [];
    const cityByName = new Map(cities.map((city) => [city.name, city]));
    const cityIds = cities.map((city) => Number(city.id));
    const packageRepo = this.dataSource.getRepository(AnnualPackageEntity);
    const packages = cityIds.length > 0
      ? await packageRepo.find({ where: { reportYear, cityId: In(cityIds) } })
      : [];
    const packageByCityId = new Map(packages.map((pkg) => [Number(pkg.cityId), pkg]));
    const packageIds = packages.map((pkg) => Number(pkg.id));
    const [contractRows, costRows, maintenanceRows] = packageIds.length > 0
      ? await Promise.all([
          this.dataSource.getRepository(ContractMonthRowEntity).find({ where: { packageId: In(packageIds) } }),
          this.dataSource.getRepository(CostMonthRowEntity).find({ where: { packageId: In(packageIds) } }),
          this.dataSource.getRepository(MaintenanceMonthRowEntity).find({ where: { packageId: In(packageIds) } }),
        ])
      : [[], [], []];
    const contractKeys = new Set(
      contractRows.map((row) => `${row.packageId}|${row.contractCodeSnapshot}|${row.monthNo}`),
    );
    const costKeys = new Set(
      costRows.map((row) => `${row.packageId}|${row.monthNo}|${row.costCategoryCode}`),
    );
    const maintenanceKeys = new Set(
      maintenanceRows.map((row) => `${row.packageId}|${row.monthNo}`),
    );

    let contractOverwriteCount = 0;
    let costOverwriteCount = 0;
    let maintenanceOverwriteCount = 0;
    for (const row of parsed.monthlyRows) {
      const city = cityByName.get(row.cityName);
      const pkg = city ? packageByCityId.get(Number(city.id)) : undefined;
      if (pkg && contractKeys.has(`${pkg.id}|${row.contractCode}|${row.monthNo}`)) {
        contractOverwriteCount += 1;
      }
    }
    for (const row of parsed.costRows) {
      const city = cityByName.get(row.cityName);
      const pkg = city ? packageByCityId.get(Number(city.id)) : undefined;
      if (pkg && costKeys.has(`${pkg.id}|${row.monthNo}|${row.costCategoryCode}`)) {
        costOverwriteCount += 1;
      }
    }
    const maintenancePackages = new Set<number>();
    for (const row of parsed.maintenanceRows) {
      const city = cityByName.get(row.cityName);
      const pkg = city ? packageByCityId.get(Number(city.id)) : undefined;
      if (pkg && maintenanceKeys.has(`${pkg.id}|12`)) {
        maintenancePackages.add(Number(pkg.id));
      }
    }
    maintenanceOverwriteCount = maintenancePackages.size;
    const overwriteCount = contractOverwriteCount + costOverwriteCount + maintenanceOverwriteCount;
    const totalCount = parsed.monthlyRows.length + parsed.costRows.length + parsed.maintenanceRows.length;
    return {
      overwriteCount,
      insertCount: Math.max(0, totalCount - overwriteCount),
      contractOverwriteCount,
      costOverwriteCount,
      maintenanceOverwriteCount,
    };
  }

  private toPreview(
    parsed: ParsedReportingImport,
    errors: ImportErrorRow[],
    selectedCityName: string | null,
    diffSummary: ReportingDiffSummary,
  ): ReportingPreviewResult {
    return {
      monthlyRows: parsed.monthlyRows,
      costRows: parsed.costRows,
      maintenanceRows: parsed.maintenanceRows,
      totalRows: parsed.totalRows,
      successCount: errors.length === 0 ? parsed.monthlyRows.length + parsed.costRows.length + parsed.maintenanceRows.length : 0,
      failCount: errors.length,
      errors,
      diffSummary,
      validation: {
        isValid: errors.length === 0,
        detectedCityNames: parsed.detectedCityNames,
        selectedCityName,
        blockingErrorCount: errors.length,
      },
    };
  }

  private getRows(sheet: XLSX.WorkSheet | undefined): CellValue[][] {
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as CellValue[][];
  }

  private cellText(value: CellValue): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
  }

  private toNumber(value: CellValue): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? this.round2(value) : null;
    const text = String(value).replace(/[,\s￥¥元]/g, '');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const valueNumber = Number(match[0]);
    return Number.isFinite(valueNumber) ? this.round2(valueNumber) : null;
  }

  private normalizeCityName(value: string): string | null {
    const raw = value.replace(/[（(].*?[）)]/g, '').replace(/市$/, '').trim();
    if (!raw) return null;
    const cityNames = ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'];
    return cityNames.find((name) => raw.includes(name)) ?? null;
  }

  private inferCityName(fileName: string): string | null {
    const cityNames = ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'];
    return cityNames.find((name) => fileName.includes(name)) ?? null;
  }

  private isMeaningfulCode(code: string): boolean {
    const value = code.trim();
    return value !== '' && !['无', '暂无', '待定', '-', '—', '·', '。', '…', '0', 'null', 'NULL'].includes(value);
  }

  private syntheticCode(cityName: string, contractName: string): string {
    const hash = createHash('sha1').update(`${cityName}|${contractName}`).digest('hex').slice(0, 10).toUpperCase();
    return `NO-CODE-${cityName}-${hash}`;
  }

  private looksLikeContractName(text: string): boolean {
    return text.includes("合同") || text.length > 8;
  }

  private looksLikeContractCode(value: CellValue): boolean {
    if (typeof value === 'number') return false;
    const text = this.cellText(value);
    if (!this.isMeaningfulCode(text)) return false;
    return !/^\d+(?:\.\d+)?$/.test(text);
  }

  private normalizeContractCode(value: string): string {
    return value.replace(/\s*\/\s*/g, '/').replace(/\s+/g, '').trim();
  }

  /** Execute one database-native upsert and disable TypeORM's generated-id entity hydration. */
  private async atomicUpsert<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    data: QueryDeepPartialEntity<T>,
    conflictPropertyPaths: Array<keyof T & string>,
    overwritePropertyPaths: Array<keyof T & string>,
  ): Promise<void> {
    const repo = manager.getRepository(entityClass);
    const databaseNames = (propertyPaths: Array<keyof T & string>): string[] => propertyPaths.map((propertyPath) => {
      const column = repo.metadata.findColumnWithPropertyPath(propertyPath);
      if (!column) throw new Error(`原子写入列不存在：${repo.metadata.name}.${propertyPath}`);
      return column.databaseName;
    });

    await repo.createQueryBuilder()
      .insert()
      .values(data)
      .orUpdate(databaseNames(overwritePropertyPaths), databaseNames(conflictPropertyPaths))
      .updateEntity(false)
      .execute();
  }

  private allocationKey(contractId: number, cityId: number): string {
    return `${contractId}:${cityId}`;
  }

  private round2(value: number): number {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
