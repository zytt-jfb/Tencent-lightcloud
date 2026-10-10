import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  MaintenanceListQuery,
  MaintenancePersonnelListResponse,
} from '@biz-reporting/shared-types';
import { Repository } from 'typeorm';
import { conflict, idOr404, newId, requireText } from '../maintenance.crud';
import { MaintenancePersonnelEntity } from './personnel.entity';
import { CreatePersonnelDto, UpdatePersonnelDto } from './personnel.dto';

@Injectable()
export class MaintenancePersonnelService {
  constructor(
    @InjectRepository(MaintenancePersonnelEntity)
    private readonly personnelRepository: Repository<MaintenancePersonnelEntity>,
  ) {}

  async create(dto: CreatePersonnelDto) { const entity = this.personnelRepository.create({ ...dto, personnelCode: requireText(dto.personnelCode, '人员编号'), name: requireText(dto.name, '姓名'), id: newId(), status: 'active', deletedAt: null }); try { return await this.personnelRepository.save(entity); } catch (error) { return conflict(error); } }
  async update(id: string, dto: UpdatePersonnelDto) { const entity = idOr404(await this.personnelRepository.findOneBy({ id }), '人员'); Object.assign(entity, dto); try { return await this.personnelRepository.save(entity); } catch (error) { return conflict(error); } }
  async remove(id: string) { const entity = idOr404(await this.personnelRepository.findOneBy({ id }), '人员'); entity.status = 'inactive'; entity.deletedAt = new Date(); await this.personnelRepository.save(entity); return { id, deleted: true }; }

  async list(query: MaintenanceListQuery): Promise<MaintenancePersonnelListResponse> {
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
    if (query.orgProvince) queryBuilder.andWhere('personnel.orgProvince = :orgProvince', { orgProvince: query.orgProvince });
    if (query.orgCity) queryBuilder.andWhere('personnel.orgCity = :orgCity', { orgCity: query.orgCity });
    if (query.orgCompany) queryBuilder.andWhere('personnel.orgCompany = :orgCompany', { orgCompany: query.orgCompany });
    if (query.orgRegion) queryBuilder.andWhere('personnel.orgRegion = :orgRegion', { orgRegion: query.orgRegion });
    if (query.status) queryBuilder.andWhere('personnel.status = :status', { status: query.status });

    const [entities, total] = await queryBuilder
      .orderBy('personnel.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

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
        mobile: entity.mobile,
        idCard: entity.idCard,
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
