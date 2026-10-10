import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizOrderImportBatchEntity } from '../orders/biz-order-import-batch.entity';
import { BizOrderImportErrorEntity } from '../orders/biz-order-import-error.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizContractImportRecordEntity } from '../contracts/biz-contract-import-record.entity';
import { BizContractImportSheetEntity } from '../contracts/biz-contract-import-sheet.entity';
import { BizContractSourceRowEntity } from '../contracts/biz-contract-source-row.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizContractAlertEntity } from '../contracts/biz-contract-alert.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostCategoryEntity } from '../costs/biz-cost-category.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { BizAnnouncementEntity } from '../biz-communications/biz-announcement.entity';
import { BizAnnouncementReadEntity } from '../biz-communications/biz-announcement-read.entity';
import { BizMessageEntity } from '../reminders/biz-message.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { MaintenancePersonnelEntity } from '../maintenance/personnel/personnel.entity';
import { MaintenanceVehicleEntity } from '../maintenance/vehicles/vehicle.entity';
import { MaintenanceGeneratorEntity } from '../maintenance/generators/generator.entity';

export const SUPER_DELETABLE_RESOURCES = [
  'maintenance-personnel', 'maintenance-vehicle', 'maintenance-generator',
  'order-import-record',
  'order-row',
  'contract-import-record',
  'contract',
  'contract-allocation',
  'contract-fee-rate',
  'contract-alert',
  'offline-completion',
  'cost-entry',
  'cost-category',
  'province',
  'city',
  'city-alias',
  'announcement',
  'announcement-read',
  'message',
  'operation-log',
] as const;

export type SuperDeletableResource = typeof SUPER_DELETABLE_RESOURCES[number];

export interface SuperDeleteResourceMeta {
  code: SuperDeletableResource;
  label: string;
}

export interface SuperDeleteListItem {
  id: string;
  label: string;
  details: string;
  createdAt: Date | null;
}

@Injectable()
export class BizDataDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly aggregates: BizAggregateService,
    @InjectRepository(BizOrderImportBatchEntity) private readonly orderBatchRepo: Repository<BizOrderImportBatchEntity>,
    @InjectRepository(BizOrderRowEntity) private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizContractImportRecordEntity) private readonly contractImportRepo: Repository<BizContractImportRecordEntity>,
    @InjectRepository(BizContractEntity) private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizOfflineCompletionEntity) private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(BizCostEntryEntity) private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizCostCategoryEntity) private readonly costCategoryRepo: Repository<BizCostCategoryEntity>,
    @InjectRepository(ProvinceEntity) private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(CityAliasEntity) private readonly cityAliasRepo: Repository<CityAliasEntity>,
    @InjectRepository(BizAnnouncementEntity) private readonly announcementRepo: Repository<BizAnnouncementEntity>,
    @InjectRepository(BizAnnouncementReadEntity) private readonly announcementReadRepo: Repository<BizAnnouncementReadEntity>,
    @InjectRepository(BizMessageEntity) private readonly messageRepo: Repository<BizMessageEntity>,
    @InjectRepository(BizOperationLogEntity) private readonly operationLogRepo: Repository<BizOperationLogEntity>,
  ) {}

  resources(): SuperDeleteResourceMeta[] {
    return [
      { code: 'maintenance-personnel', label: '维护管理 / 人员' },
      { code: 'maintenance-vehicle', label: '维护管理 / 车辆' },
      { code: 'maintenance-generator', label: '维护管理 / 油机' },
      { code: 'order-import-record', label: '订单上传记录' },
      { code: 'order-row', label: '订单行' },
      { code: 'contract-import-record', label: '合同上传记录' },
      { code: 'contract', label: '合同' },
      { code: 'contract-allocation', label: '合同分配' },
      { code: 'contract-fee-rate', label: '合同费率' },
      { code: 'contract-alert', label: '合同预警' },
      { code: 'offline-completion', label: '线下完工' },
      { code: 'cost-entry', label: '成本明细' },
      { code: 'cost-category', label: '成本分类' },
      { code: 'province', label: '省份' },
      { code: 'city', label: '经营单位' },
      { code: 'city-alias', label: '经营单位别名' },
      { code: 'announcement', label: '公告' },
      { code: 'announcement-read', label: '公告阅读记录' },
      { code: 'message', label: '站内消息' },
      { code: 'operation-log', label: '操作日志' },
    ];
  }

  async list(auth: BizAuthContext, resource: string): Promise<SuperDeleteListItem[]> {
    this.assertSuperAdmin(auth);
    const normalized = this.normalizeResource(resource);
    switch (normalized) {
      case 'maintenance-personnel': return (await this.dataSource.getRepository(MaintenancePersonnelEntity).find({ take: 200, order: { createdAt: 'DESC' } })).map(item => ({ id: item.id, label: item.name, details: `${item.personnelCode} / ${item.orgRegion}`, createdAt: item.createdAt }));
      case 'maintenance-vehicle': return (await this.dataSource.getRepository(MaintenanceVehicleEntity).find({ take: 200, order: { createdAt: 'DESC' } })).map(item => ({ id: item.id, label: item.plateNumber, details: item.orgRegion, createdAt: item.createdAt }));
      case 'maintenance-generator': return (await this.dataSource.getRepository(MaintenanceGeneratorEntity).find({ take: 200, order: { createdAt: 'DESC' } })).map(item => ({ id: item.id, label: item.generatorCode, details: item.orgRegion, createdAt: item.createdAt }));
      case 'order-import-record': return (await this.orderBatchRepo.find({ order: { uploadedAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.filename, details: `${item.status} / ${item.totalRows} 行`, createdAt: item.uploadedAt }));
      case 'order-row': return (await this.orderRowRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.purchaseOrderNo || `订单行 ${item.sourceRowNo}`, details: `${item.businessMonth ?? '-'} / ${item.validationStatus}`, createdAt: item.createdAt }));
      case 'contract-import-record': return (await this.contractImportRepo.find({ order: { uploadedAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.filename, details: `${item.status} / ${item.totalRows} 行`, createdAt: item.uploadedAt }));
      case 'contract': return (await this.contractRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.contractNo, details: item.contractName, createdAt: item.createdAt }));
      case 'contract-allocation': return (await this.dataSource.getRepository(BizContractCityAllocationEntity).find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.contractId, details: `${item.cityId} / ${item.status}`, createdAt: item.createdAt }));
      case 'contract-fee-rate': return (await this.dataSource.getRepository(BizContractFeeRateEntity).find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.contractId, details: `${item.cityId} / ${item.effectiveMonth} / ${item.rateBp} BP`, createdAt: item.createdAt }));
      case 'contract-alert': return (await this.dataSource.getRepository(BizContractAlertEntity).find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.contractId, details: `${item.alertType} / ${item.currentStatus}`, createdAt: item.createdAt }));
      case 'offline-completion': return (await this.offlineRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.summary, details: `${item.businessMonth} / ${item.status}`, createdAt: item.createdAt }));
      case 'cost-entry': return (await this.costRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.categoryCode, details: `${item.businessMonth} / ${item.status}`, createdAt: item.createdAt }));
      case 'cost-category': return (await this.costCategoryRepo.find({ order: { sortOrder: 'ASC' }, take: 200 })).map((item) => ({ id: item.id, label: item.name, details: item.code, createdAt: item.createdAt }));
      case 'province': return (await this.provinceRepo.find({ order: { name: 'ASC' }, take: 200 })).map((item) => ({ id: item.id, label: item.name, details: item.code, createdAt: item.createdAt }));
      case 'city': return (await this.cityRepo.find({ order: { name: 'ASC' }, take: 200 })).map((item) => ({ id: item.id, label: item.name, details: `${item.code} / ${item.unitType}`, createdAt: item.createdAt }));
      case 'city-alias': return (await this.cityAliasRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.alias, details: item.cityId, createdAt: item.createdAt }));
      case 'announcement': return (await this.announcementRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.title, details: item.status, createdAt: item.createdAt }));
      case 'announcement-read': return (await this.announcementReadRepo.find({ order: { readAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.announcementId, details: item.userId, createdAt: item.readAt }));
      case 'message': return (await this.messageRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.messageType, details: item.content, createdAt: item.createdAt }));
      case 'operation-log': return (await this.operationLogRepo.find({ order: { createdAt: 'DESC' }, take: 200 })).map((item) => ({ id: item.id, label: item.actionType, details: `${item.targetType} / ${item.targetId}`, createdAt: item.createdAt }));
    }
  }

  async delete(auth: BizAuthContext, resource: string, id: string): Promise<{ resource: SuperDeletableResource; id: string; deleted: Record<string, number> }> {
    this.assertSuperAdmin(auth);
    const normalized = this.normalizeResource(resource);
    const targetId = id.trim();
    if (!targetId) throw new BadRequestException('缺少待删除记录 ID');
    const deleted = await this.dataSource.transaction((manager) => this.deleteInTransaction(manager, normalized, targetId, auth.userId));
    if (!normalized.startsWith('maintenance-')) await this.aggregates.recalcInternal({});
    return { resource: normalized, id: targetId, deleted };
  }

  private async deleteInTransaction(manager: EntityManager, resource: SuperDeletableResource, id: string, operatorUserId: string): Promise<Record<string, number>> {
    const deleted: Record<string, number> = {};
    const remove = async <T extends object>(entity: { new(): T }, where: object, key: string) => {
      const result = await manager.delete(entity, where);
      deleted[key] = (deleted[key] ?? 0) + (result.affected ?? 0);
      return result.affected ?? 0;
    };
    const requireTarget = async <T extends object>(entity: { new(): T }, key: string): Promise<void> => {
      const exists = await manager.getRepository(entity).exist({ where: { id } as never });
      if (!exists) throw new NotFoundException(`${key}不存在或已删除`);
    };
    const removeContractChildren = async (contractIds: string[]) => {
      for (const contractId of contractIds) {
        await remove(BizContractFeeRateEntity, { contractId }, 'contractFeeRates');
        await remove(BizContractCityAllocationEntity, { contractId }, 'contractAllocations');
        await remove(BizContractAlertEntity, { contractId }, 'contractAlerts');
      }
    };

    switch (resource) {
      case 'maintenance-personnel':
        await requireTarget(MaintenancePersonnelEntity, '人员');
        await remove(MaintenancePersonnelEntity, { id }, 'maintenancePersonnel');
        break;
      case 'maintenance-vehicle':
        await requireTarget(MaintenanceVehicleEntity, '车辆');
        await remove(MaintenanceVehicleEntity, { id }, 'maintenanceVehicles');
        break;
      case 'maintenance-generator':
        await requireTarget(MaintenanceGeneratorEntity, '油机');
        await remove(MaintenanceGeneratorEntity, { id }, 'maintenanceGenerators');
        break;
      case 'order-import-record':
        await requireTarget(BizOrderImportBatchEntity, '订单上传记录');
        await remove(BizOrderImportErrorEntity, { batchId: id }, 'orderImportErrors');
        await remove(BizOrderRowEntity, { batchId: id }, 'orderRows');
        await remove(BizOrderImportBatchEntity, { id }, 'orderImportRecords');
        break;
      case 'order-row': {
        await requireTarget(BizOrderRowEntity, '订单行');
        const row = await manager.getRepository(BizOrderRowEntity).findOneBy({ id });
        if (row) await remove(BizOrderImportErrorEntity, { batchId: row.batchId, rowNo: row.sourceRowNo }, 'orderImportErrors');
        await remove(BizOrderRowEntity, { id }, 'orderRows');
        break;
      }
      case 'contract-import-record': {
        await requireTarget(BizContractImportRecordEntity, '合同上传记录');
        const contracts = await manager.getRepository(BizContractEntity).findBy({ sourceImportRecordId: id });
        const contractIds = contracts.map((item) => item.id);
        await removeContractChildren(contractIds);
        for (const contractId of contractIds) await remove(BizContractEntity, { id: contractId }, 'contracts');
        await remove(BizContractSourceRowEntity, { importRecordId: id }, 'contractSourceRows');
        await remove(BizContractImportSheetEntity, { importRecordId: id }, 'contractImportSheets');
        await remove(BizContractImportRecordEntity, { id }, 'contractImportRecords');
        break;
      }
      case 'contract':
        await requireTarget(BizContractEntity, '合同');
        await removeContractChildren([id]);
        await remove(BizContractEntity, { id }, 'contracts');
        break;
      case 'contract-allocation':
        await requireTarget(BizContractCityAllocationEntity, '合同分配');
        await remove(BizContractCityAllocationEntity, { id }, 'contractAllocations');
        break;
      case 'contract-fee-rate':
        await requireTarget(BizContractFeeRateEntity, '合同费率');
        await remove(BizContractFeeRateEntity, { id }, 'contractFeeRates');
        break;
      case 'contract-alert':
        await requireTarget(BizContractAlertEntity, '合同预警');
        await remove(BizContractAlertEntity, { id }, 'contractAlerts');
        break;
      case 'offline-completion':
        await requireTarget(BizOfflineCompletionEntity, '线下完工');
        await remove(BizOfflineCompletionEntity, { id }, 'offlineCompletions');
        break;
      case 'cost-entry':
        await requireTarget(BizCostEntryEntity, '成本明细');
        await remove(BizCostEntryEntity, { id }, 'costEntries');
        break;
      case 'cost-category':
        await requireTarget(BizCostCategoryEntity, '成本分类');
        await remove(BizCostCategoryEntity, { id }, 'costCategories');
        break;
      case 'province':
        await requireTarget(ProvinceEntity, '省份');
        await remove(ProvinceEntity, { id }, 'provinces');
        break;
      case 'city':
        await requireTarget(CityEntity, '经营单位');
        await remove(CityAliasEntity, { cityId: id }, 'cityAliases');
        await remove(CityEntity, { id }, 'cities');
        break;
      case 'city-alias':
        await requireTarget(CityAliasEntity, '经营单位别名');
        await remove(CityAliasEntity, { id }, 'cityAliases');
        break;
      case 'announcement':
        await requireTarget(BizAnnouncementEntity, '公告');
        await remove(BizAnnouncementReadEntity, { announcementId: id }, 'announcementReads');
        await remove(BizAnnouncementEntity, { id }, 'announcements');
        break;
      case 'announcement-read':
        await requireTarget(BizAnnouncementReadEntity, '公告阅读记录');
        await remove(BizAnnouncementReadEntity, { id }, 'announcementReads');
        break;
      case 'message':
        await requireTarget(BizMessageEntity, '站内消息');
        await remove(BizMessageEntity, { id }, 'messages');
        break;
      case 'operation-log':
        await requireTarget(BizOperationLogEntity, '操作日志');
        await remove(BizOperationLogEntity, { id }, 'operationLogs');
        break;
    }
    await manager.insert(BizOperationLogEntity, {
      id: randomUUID(), operatorUserId, actionType: 'super_data.delete', targetType: resource,
      targetId: id, resultStatus: 'success', summaryAfter: JSON.stringify(deleted),
    });
    return deleted;
  }

  private assertSuperAdmin(auth: BizAuthContext): void {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可删除数据');
  }

  private normalizeResource(resource: string): SuperDeletableResource {
    if ((SUPER_DELETABLE_RESOURCES as readonly string[]).includes(resource)) return resource as SuperDeletableResource;
    throw new BadRequestException('不支持的数据类型');
  }
}
