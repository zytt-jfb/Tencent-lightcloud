import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('biz_announcement_reads')
@Index('uk_biz_announcement_read', ['announcementId', 'userId'], { unique: true })
@Index('idx_biz_announcement_read_user', ['userId', 'readAt'])
export class BizAnnouncementReadEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ name: 'announcement_id', type: 'varchar', length: 36 }) announcementId: string;
  @Column({ name: 'user_id', type: 'varchar', length: 36 }) userId: string;
  @CreateDateColumn({ name: 'read_at', type: 'datetime' }) readAt: Date;
}
