import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  MaintenanceListQuery,
  MaintenancePersonnelListResponse,
} from '@biz-reporting/shared-types';
import { Repository } from 'typeorm';
import { conflict, idOr404, isMaskedValue, maskIdCard, maskMobile, newId, requireText } from '../maintenance.crud';
import { MaintenancePersonnelEntity } from './personnel.entity';
import { CreatePersonnelDto, UpdatePersonnelDto } from './personnel.dto';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { MaintenanceScopeService } from '../maintenance-scope.service';
import { BizAuthContext } from '../../rbac/rbac.service';

@Injectable()
export class MaintenancePersonnelService {
  constructor(
    @InjectRepository(MaintenancePersonnelEntity)
    private readonly personnelRepository: Repository<MaintenancePersonnelEntity>,
    private readonly documents: MaintenanceDocumentService,
    private readonly scope: MaintenanceScopeService,
  ) {}

  /** 身份证 / 手机号明文需要 maintenance.sensitive.read（默认只给 admin） */
  private canReadSensitive(auth: BizAuthContext) { return auth.isSuperAdmin || auth.permissionCodes.has('maintenance.sensitive.read'); }

  async create(dto: CreatePersonnelDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as CreatePersonnelDto & { documentFileIds?: string[] };
    // 权限点管「能不能写」，数据范围管「能写哪个地市」，两者必须同时成立
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity);
    const entity = this.personnelRepository.create({
      ...fields,
      personnelCode: requireText(dto.personnelCode, '人员编号'),
      name: requireText(dto.name, '姓名'),
      id: newId(),
      status: 'active',
      deletedAt: null,
    });
    try {
      const saved = await this.personnelRepository.save(entity);
      await this.documents.attach('personnel', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      await this.personnelRepository.delete(entity.id).catch(() => undefined);
      return conflict(error);
    }
  }

  async update(id: string, dto: UpdatePersonnelDto, auth: BizAuthContext) {
    const { documentFileIds = [], ...fields } = dto as UpdatePersonnelDto & { documentFileIds?: string[] };
    const entity = idOr404(await this.personnelRepository.findOneBy({ id }), '人员');
    await this.scope.assertWritable(auth, entity.orgCity);
    await this.scope.assertWritable(auth, (fields as { orgCity?: string | null }).orgCity ?? entity.orgCity);
    // 掩码值不能覆盖真值：无权限账号回传的是 3701****1234，直接写会把库里真身份证写坏
    const patch = fields as Record<string, unknown>;
    for (const key of ['idCard', 'mobile']) if (isMaskedValue(patch[key])) delete patch[key];
    Object.assign(entity, fields);
    try {
      const saved = await this.personnelRepository.save(entity);
      await this.documents.attach('personnel', saved.id, documentFileIds, auth);
      return saved;
    } catch (error) {
      return conflict(error);
    }
  }

  listDocuments(id: string, auth: BizAuthContext) { return this.documents.list('personnel', id, auth); }
  async remove(id: string) { const entity = idOr404(await this.personnelRepository.findOneBy({ id }), '人员'); entity.status = 'inactive'; entity.deletedAt = new Date(); await this.personnelRepository.save(entity); return { id, deleted: true }; }

  async list(query: MaintenanceListQuery, auth: BizAuthContext): Promise<MaintenancePersonnelListResponse> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const queryBuilder = this.personnelRepository.createQueryBuilder('personnel')
      .where('personnel.deletedAt IS NULL');

    if (query.keyword?.trim()) {
      const keyword = `%${query.keyword.trim()}%`;
      queryBuilder.andWhere(
        '(personnel.personnelCode LIKE :keyword OR personnel.name LIKE :keyword OR personnel.account LIKE :keyword OR personnel.mobile LIKE :keyword)',
        { keyword },
      );
    }
    if (query.orgProvince) queryBuilder.andWhere('personnel.orgProvince LIKE :orgProvince', { orgProvince: `%${query.orgProvince}%` });
    if (query.orgCity) queryBuilder.andWhere('personnel.orgCity LIKE :orgCity', { orgCity: `%${query.orgCity}%` });
    if (query.orgCompany) queryBuilder.andWhere('personnel.orgCompany LIKE :orgCompany', { orgCompany: `%${query.orgCompany}%` });
    if (query.orgRegion) queryBuilder.andWhere('personnel.orgRegion LIKE :orgRegion', { orgRegion: `%${query.orgRegion}%` });
    if (query.status) queryBuilder.andWhere('personnel.status = :status', { status: query.status });
    this.scope.apply(queryBuilder, await this.scope.resolve(auth), 'personnel');

    const [entities, total] = await queryBuilder
      .orderBy('personnel.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const sensitive = this.canReadSensitive(auth);

    return {
      items: entities.map((entity) => ({
        id: entity.id,
        personnelCode: entity.personnelCode,
        name: entity.name,
        gender: entity.gender,
        age: entity.age,
        account: entity.account,
        position: entity.position,
        employmentType: entity.employmentType,
        mobile: sensitive ? entity.mobile : maskMobile(entity.mobile),
        idCard: sensitive ? entity.idCard : maskIdCard(entity.idCard),
        lowVoltageCert: entity.lowVoltageCert,
        lowVoltageCertExpiry: entity.lowVoltageCertExpiry,
        highVoltageCert: entity.highVoltageCert,
        highVoltageCertExpiry: entity.highVoltageCertExpiry,
        workAtHeightCert: entity.workAtHeightCert,
        workAtHeightCertExpiry: entity.workAtHeightCertExpiry,
        employerLiabilityAmount: entity.employerLiabilityAmount,
        employerLiabilityPolicyNo: entity.employerLiabilityPolicyNo,
        employerLiabilityExpiry: entity.employerLiabilityExpiry,
        teamAccidentAmount: entity.teamAccidentAmount,
        teamAccidentPolicyNo: entity.teamAccidentPolicyNo,
        teamAccidentExpiry: entity.teamAccidentExpiry,
        teamAccidentAmount2: entity.teamAccidentAmount2,
        teamAccidentPolicyNo2: entity.teamAccidentPolicyNo2,
        teamAccidentExpiry2: entity.teamAccidentExpiry2,
        teamAccidentAmount3: entity.teamAccidentAmount3,
        teamAccidentPolicyNo3: entity.teamAccidentPolicyNo3,
        teamAccidentExpiry3: entity.teamAccidentExpiry3,
        personnelCondition: entity.personnelCondition,
        orgProvince: entity.orgProvince,
        orgCity: entity.orgCity,
        orgCompany: entity.orgCompany,
        orgRegion: entity.orgRegion,
        status: entity.status,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
