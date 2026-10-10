import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { PlatformRole } from '@biz-reporting/shared-types';
import { BizAuthContext, RbacService } from '../rbac/rbac.service';
import { CityEntity } from '../main-data/city.entity';
import { BizMessageEntity } from '../reminders/biz-message.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizAnnouncementEntity } from './biz-announcement.entity';
import { BizAnnouncementReadEntity } from './biz-announcement-read.entity';

export type AnnouncementAudience = 'all' | 'province' | 'city';
export interface AnnouncementInput {
  title: string;
  content: string;
  linkUrl?: string | null;
  audienceType: AnnouncementAudience;
  provinceId?: string | null;
  cityId?: string | null;
  expiresAt?: string | null;
}

@Injectable()
export class BizCommunicationService {
  constructor(
    @InjectRepository(BizAnnouncementEntity) private readonly announcementRepo: Repository<BizAnnouncementEntity>,
    @InjectRepository(BizAnnouncementReadEntity) private readonly readRepo: Repository<BizAnnouncementReadEntity>,
    @InjectRepository(BizMessageEntity) private readonly messageRepo: Repository<BizMessageEntity>,
    @InjectRepository(BizOperationLogEntity) private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    private readonly rbac: RbacService,
  ) {}

  private async cityProvince(cityId: string): Promise<string> {
    const city = await this.cityRepo.findOneBy({ id: cityId });
    if (!city) throw new BadRequestException('地市不存在');
    return city.provinceId;
  }

  private validLink(linkUrl?: string | null): string | null {
    const value = linkUrl?.trim() || null;
    if (!value) return null;
    if (value.startsWith('/biz/')) return value;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return value;
    } catch { /* handled below */ }
    throw new BadRequestException('超链接必须是 /biz/ 内部路径或 http(s) 地址');
  }

  private async assertAudienceScope(auth: BizAuthContext, audienceType: AnnouncementAudience, provinceId?: string | null, cityId?: string | null): Promise<void> {
    if (audienceType === 'all') {
      if (!auth.isSuperAdmin) throw new ForbiddenException('只有超级管理员可以发布全省公告');
      return;
    }
    if (audienceType === 'province') {
      if (!provinceId) throw new BadRequestException('省级公告必须选择省份');
      await this.rbac.assertProvinceScope(auth, provinceId);
      return;
    }
    if (!cityId) throw new BadRequestException('地市公告必须选择地市');
    await this.rbac.assertCityScope(auth, cityId);
    if (provinceId && provinceId !== await this.cityProvince(cityId)) throw new BadRequestException('省份与地市不匹配');
  }

  private async canSee(auth: BizAuthContext, item: BizAnnouncementEntity): Promise<boolean> {
    if (item.status !== 'published') return false;
    const now = Date.now();
    if (item.publishAt && item.publishAt.getTime() > now) return false;
    if (item.expiresAt && item.expiresAt.getTime() < now) return false;
    if (item.audienceType === 'all' || auth.isSuperAdmin) return true;
    if (item.audienceType === 'city') {
      if (!item.cityId) return false;
      const allowedCityIds = auth.dataScope.cityIds?.length
        ? auth.dataScope.cityIds
        : auth.dataScope.cityId ? [auth.dataScope.cityId] : [];
      return allowedCityIds.includes(item.cityId)
        || Boolean(item.cityId && (await this.rbac.assertCityScope(auth, item.cityId).then(() => true).catch(() => false)));
    }
    if (item.audienceType === 'province') {
      if (!item.provinceId) return false;
      const allowedCityIds = auth.dataScope.cityIds?.length
        ? auth.dataScope.cityIds
        : auth.dataScope.cityId ? [auth.dataScope.cityId] : [];
      if (allowedCityIds.length) {
        const provinces = await Promise.all(allowedCityIds.map((cid) => this.cityProvince(cid)));
        return provinces.includes(item.provinceId);
      }
      return auth.dataScope.scopeType === 'province' && (auth.dataScope.provinceIds.length === 0 || auth.dataScope.provinceIds.includes(item.provinceId));
    }
    return false;
  }

  async listInbox(auth: BizAuthContext) {
    const announcements = await this.announcementRepo.find({ where: { status: 'published' }, order: { publishAt: 'DESC', createdAt: 'DESC' }, take: 200 });
    const visible = (await Promise.all(announcements.map(async (item) => (await this.canSee(auth, item) ? item : null)))).filter((item): item is BizAnnouncementEntity => Boolean(item));
    const readRows = visible.length ? await this.readRepo.findBy({ userId: auth.userId, announcementId: In(visible.map((item) => item.id)) }) : [];
    const readIds = new Set(readRows.map((row) => row.announcementId));
    const announcementItems = visible.map((item) => ({ id: item.id, source: 'announcement' as const, messageType: 'announcement', title: item.title, content: item.content, linkUrl: item.linkUrl, status: readIds.has(item.id) ? 'read' : 'unread', createdAt: item.publishAt ?? item.createdAt }));
    const systemMessages = await this.messageRepo.find({ where: { recipientId: auth.userId }, order: { createdAt: 'DESC' }, take: 100 });
    const messageItems = systemMessages.map((item) => ({ id: item.id, source: 'system' as const, messageType: item.messageType, title: '系统消息', content: item.content, linkUrl: null, status: item.status, createdAt: item.createdAt }));
    const items = [...announcementItems, ...messageItems].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return { items, unreadCount: items.filter((item) => item.status === 'unread').length };
  }

  async markRead(auth: BizAuthContext, id: string, source: 'announcement' | 'system'): Promise<{ ok: boolean }> {
    if (source === 'system') {
      const message = await this.messageRepo.findOneBy({ id, recipientId: auth.userId });
      if (!message) throw new NotFoundException('消息不存在');
      message.status = 'read'; await this.messageRepo.save(message); return { ok: true };
    }
    const item = await this.announcementRepo.findOneBy({ id });
    if (!item || !(await this.canSee(auth, item))) throw new NotFoundException('公告不存在');
    const existing = await this.readRepo.findOneBy({ announcementId: id, userId: auth.userId });
    if (!existing) await this.readRepo.save({ id: randomUUID(), announcementId: id, userId: auth.userId });
    return { ok: true };
  }

  async manageList(auth: BizAuthContext): Promise<BizAnnouncementEntity[]> {
    if (!auth.isSuperAdmin && auth.roleCode !== PlatformRole.ADMIN) throw new ForbiddenException('只有管理端可以管理公告');
    return this.announcementRepo.find({ where: auth.isSuperAdmin ? undefined : { createdBy: auth.userId }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async create(auth: BizAuthContext, dto: AnnouncementInput): Promise<BizAnnouncementEntity> {
    if (!dto.title?.trim() || !dto.content?.trim()) throw new BadRequestException('公告标题和内容必填');
    await this.assertAudienceScope(auth, dto.audienceType, dto.provinceId, dto.cityId);
    const item = await this.announcementRepo.save({ id: randomUUID(), title: dto.title.trim().slice(0, 200), content: dto.content.trim(), linkUrl: this.validLink(dto.linkUrl), audienceType: dto.audienceType, provinceId: dto.audienceType === 'province' ? dto.provinceId : null, cityId: dto.audienceType === 'city' ? dto.cityId : null, status: 'draft', expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, createdBy: auth.userId });
    await this.opLogRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'announcement.create', targetType: 'announcement', targetId: item.id, resultStatus: 'success' });
    return item;
  }

  async update(auth: BizAuthContext, id: string, dto: AnnouncementInput): Promise<BizAnnouncementEntity> {
    const item = await this.announcementRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('公告不存在');
    if (!auth.isSuperAdmin && item.createdBy !== auth.userId) throw new ForbiddenException('只能修改自己创建的公告');
    if (item.status !== 'draft') throw new BadRequestException('只有草稿公告可以编辑');
    if (!dto.title?.trim() || !dto.content?.trim()) throw new BadRequestException('公告标题和内容必填');
    await this.assertAudienceScope(auth, dto.audienceType, dto.provinceId, dto.cityId);
    Object.assign(item, { title: dto.title.trim().slice(0, 200), content: dto.content.trim(), linkUrl: this.validLink(dto.linkUrl), audienceType: dto.audienceType, provinceId: dto.audienceType === 'province' ? dto.provinceId : null, cityId: dto.audienceType === 'city' ? dto.cityId : null, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null });
    return this.announcementRepo.save(item);
  }

  async publish(auth: BizAuthContext, id: string): Promise<BizAnnouncementEntity> {
    const item = await this.announcementRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('公告不存在');
    if (!auth.isSuperAdmin && item.createdBy !== auth.userId) throw new ForbiddenException('只能发布自己创建的公告');
    if (item.status !== 'draft') throw new BadRequestException('只有草稿公告可以发布');
    await this.assertAudienceScope(auth, item.audienceType, item.provinceId, item.cityId);
    item.status = 'published'; item.publishAt = new Date(); item.publishedBy = auth.userId;
    const saved = await this.announcementRepo.save(item);
    await this.opLogRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'announcement.publish', targetType: 'announcement', targetId: id, resultStatus: 'success' });
    return saved;
  }

  async withdraw(auth: BizAuthContext, id: string): Promise<BizAnnouncementEntity> {
    const item = await this.announcementRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('公告不存在');
    if (!auth.isSuperAdmin && item.createdBy !== auth.userId) throw new ForbiddenException('只能撤回自己创建的公告');
    if (item.status !== 'published') throw new BadRequestException('只有已发布公告可以撤回');
    item.status = 'withdrawn'; item.withdrawnBy = auth.userId; item.withdrawnAt = new Date();
    const saved = await this.announcementRepo.save(item);
    await this.opLogRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'announcement.withdraw', targetType: 'announcement', targetId: id, resultStatus: 'success' });
    return saved;
  }
}
