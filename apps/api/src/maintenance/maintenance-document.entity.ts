import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type MaintenanceKind = 'personnel' | 'vehicles' | 'generators';

@Entity('maintenance_document_files')
@Index('idx_maintenance_document_owner', ['maintenanceKind', 'maintenanceId', 'createdAt'])
@Index('idx_maintenance_document_uploader', ['createdBy', 'createdAt'])
export class MaintenanceDocumentEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ name: 'maintenance_kind', type: 'varchar', length: 16 }) maintenanceKind: MaintenanceKind;
  @Column({ name: 'maintenance_id', type: 'varchar', length: 36, nullable: true }) maintenanceId: string | null;
  @Column({ name: 'document_category', type: 'varchar', length: 64 }) documentCategory: string;
  @Column({ name: 'file_name', type: 'varchar', length: 255 }) fileName: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 100 }) mimeType: string;
  @Column({ name: 'file_size', type: 'bigint' }) fileSize: number;
  @Column({ name: 'file_sha256', type: 'varchar', length: 64 }) fileSha256: string;
  @Column({ name: 'storage_key', type: 'varchar', length: 500 }) storageKey: string;
  @Column({ name: 'extracted_text', type: 'text', nullable: true }) extractedText: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 36 }) createdBy: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
