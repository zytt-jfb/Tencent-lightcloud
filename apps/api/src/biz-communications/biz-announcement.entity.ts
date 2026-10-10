import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('biz_announcements')
@Index('idx_biz_announcement_status_time', ['status', 'publishAt', 'expiresAt'])
@Index('idx_biz_announcement_scope', ['audienceType', 'provinceId', 'cityId'])
@Index('idx_biz_announcement_creator', ['createdBy', 'status'])
export class BizAnnouncementEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'link_url', type: 'varchar', length: 500, nullable: true }) linkUrl: string | null;
  @Column({ name: 'audience_type', type: 'varchar', length: 16, default: 'province' }) audienceType: 'all' | 'province' | 'city';
  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true }) provinceId: string | null;
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true }) cityId: string | null;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: 'draft' | 'published' | 'withdrawn';
  @Column({ name: 'publish_at', type: 'datetime', nullable: true }) publishAt: Date | null;
  @Column({ name: 'expires_at', type: 'datetime', nullable: true }) expiresAt: Date | null;
  @Column({ name: 'created_by', type: 'varchar', length: 36 }) createdBy: string;
  @Column({ name: 'published_by', type: 'varchar', length: 36, nullable: true }) publishedBy: string | null;
  @Column({ name: 'withdrawn_by', type: 'varchar', length: 36, nullable: true }) withdrawnBy: string | null;
  @Column({ name: 'withdrawn_at', type: 'datetime', nullable: true }) withdrawnAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
