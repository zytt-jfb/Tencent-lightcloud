import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MaintenanceListQuery } from '@biz-reporting/shared-types';
import { Repository } from 'typeorm';
import { baseQuery, conflict, idOr404, maskMobile, newId, pageOf, requireText } from '../maintenance.crud';
import { MaintenanceVehicleEntity } from './vehicle.entity';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicle.dto';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { MaintenanceScopeService } from '../maintenance-scope.service';
import { BizAuthContext } from '../../rbac/rbac.service';

/** 该实体真实存在、且用户会用来搜的列（不能照抄人员表的列名，否则 SQL 1054） */
const VEHICLE_KEYWORD_COLUMNS = ['plateNumber', 'vehicleCode', 'ownerName', 'driverMobile'] as const;

@Injectable()
export class MaintenanceVehicleService {
  constructor(
    @InjectRepository(MaintenanceVehicleEntity)
    private readonly repo: Repository<MaintenanceVehicleEntity>,
    private readonly documents: MaintenanceDocumentService,
    private readonly scope: MaintenanceScopeService,
  ) {}

  /** 列表：按账号数据范围收敛到本地市；人员手机号默认掩码（maintenance.sensitive.read 才看明文） */
  async list(q: MaintenanceListQuery, auth: BizAuthContext) {
    const { page, pageSize } = pageOf(q);
    const qb = baseQuery(this.repo, 'v', q, VEHICLE_KEYWORD_COLUMNS);
    this.scope.apply(qb, await this.scope.resolve(auth), 'v');
    const [items, total] = await qb
      .orderBy('v.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const sensitive = auth.isSuperAdmin || auth.permissionCodes.has('maintenance.sensitive.read');
    return {
      items: sensitive ? items : items.map((row) => ({ ...row, driverMobile: maskMobile(row.driverMobile) })),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateVehicleDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as CreateVehicleDto & { documentFileIds?: string[] };
    // 地市账号只能在自己的范围内新增（权限点只管「能不能写」，范围管「能写哪」）
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity);
    const entity = this.repo.create({
      ...fields,
      plateNumber: requireText(dto.plateNumber, '车牌号'),
      id: newId(),
      status: 'active',
      deletedAt: null,
    });
    try {
      const saved = await this.repo.save(entity);
      await this.documents.attach('vehicles', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      await this.repo.delete(entity.id).catch(() => undefined);
      return conflict(error);
    }
  }

  async update(id: string, dto: UpdateVehicleDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as UpdateVehicleDto & { documentFileIds?: string[] };
    const entity = idOr404(await this.repo.findOneBy({ id }), '车辆');
    // 原记录必须在本范围内；同时不允许把记录的地市改到范围外
    await this.scope.assertWritable(auth, entity.orgCity);
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity ?? entity.orgCity);
    Object.assign(entity, fields);
    try {
      const saved = await this.repo.save(entity);
      await this.documents.attach('vehicles', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      return conflict(error);
    }
  }

  listDocuments(id: string, auth: BizAuthContext) {
    return this.documents.list('vehicles', id, auth);
  }

  async remove(id: string) {
    const entity = idOr404(await this.repo.findOneBy({ id }), '车辆');
    entity.status = 'inactive';
    entity.deletedAt = new Date();
    await this.repo.save(entity);
    return { id, deleted: true };
  }
}
