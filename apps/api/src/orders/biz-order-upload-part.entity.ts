import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('biz_order_upload_parts')
export class BizOrderUploadPartEntity {
  @PrimaryColumn({ name: 'upload_key', type: 'varchar', length: 128 }) uploadKey: string;
  @PrimaryColumn({ name: 'part_index', type: 'int' }) partIndex: number;
  @Column({ name: 'user_id', type: 'varchar', length: 36 }) userId: string;
  @Column({ name: 'part_count', type: 'int' }) partCount: number;
  @Column({ type: 'varchar', length: 255 }) filename: string;
  @Column({ name: 'source_batch_id', type: 'varchar', length: 36, nullable: true }) sourceBatchId: string | null;
  @Column({ name: 'data_base64', type: 'text' }) dataBase64: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
