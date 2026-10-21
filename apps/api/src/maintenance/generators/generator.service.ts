import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MaintenanceListQuery } from '@biz-reporting/shared-types';
import { Repository } from 'typeorm';
import { baseQuery, conflict, idOr404, maskMobile, newId, pageOf, requireText } from '../maintenance.crud';
import { MaintenanceGeneratorEntity } from './generator.entity';
import { CreateGeneratorDto, UpdateGeneratorDto } from './generator.dto';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { MaintenanceScopeService } from '../maintenance-scope.service';
import { BizAuthContext } from '../../rbac/rbac.service';

/** 油机表没有 name / plateNumber / account，照抄人员表的列名会直接 1054 */
const GENERATOR_KEYWORD_COLUMNS = ['generatorCode', 'externalId', 'contactName', 'contactMobile'] as const;

@Injectable()
export class MaintenanceGeneratorService {
  constructor(
    @InjectRepository(MaintenanceGeneratorEntity)
    private readonly repo: Repository<MaintenanceGeneratorEntity>,
    private readonly documents: MaintenanceDocumentService,
    private readonly scope: MaintenanceScopeService,
  ) {}

  /** 列表：按账号数据范围收敛到本地市；联系电话默认掩码 */
  async list(q: MaintenanceListQuery, auth: BizAuthContext) {
    const { page, pageSize } = pageOf(q);
    const qb = baseQuery(this.repo, 'g', q, GENERATOR_KEYWORD_COLUMNS);
    this.scope.apply(qb, await this.scope.resolve(auth), 'g');
    const [items, total] = await qb
      .orderBy('g.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const sensitive = auth.isSuperAdmin || auth.permissionCodes.has('maintenance.sensitive.read');
    return {
      items: sensitive ? items : items.map((row) => ({ ...row, contactMobile: maskMobile(row.contactMobile) })),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateGeneratorDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as CreateGeneratorDto & { documentFileIds?: string[] };
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity);
    const entity = this.repo.create({
      ...fields,
      generatorCode: requireText(dto.generatorCode, '油机编号'),
      id: newId(),
      status: 'active',
      deletedAt: null,
    });
    try {
      const saved = await this.repo.save(entity);
      await this.documents.attach('generators', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      await this.repo.delete(entity.id).catch(() => undefined);
      return conflict(error);
    }
  }

  async update(id: string, dto: UpdateGeneratorDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as UpdateGeneratorDto & { documentFileIds?: string[] };
    const entity = idOr404(await this.repo.findOneBy({ id }), '油机');
    await this.scope.assertWritable(auth, entity.orgCity);
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity ?? entity.orgCity);
    Object.assign(entity, fields);
    try {
      const saved = await this.repo.save(entity);
      await this.documents.attach('generators', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      return conflict(error);
    }
  }

  listDocuments(id: string, auth: BizAuthContext) {
    return this.documents.list('generators', id, auth);
  }

  async remove(id: string) {
    const entity = idOr404(await this.repo.findOneBy({ id }), '油机');
    entity.status = 'inactive';
    entity.deletedAt = new Date();
    await this.repo.save(entity);
    return { id, deleted: true };
  }
}
