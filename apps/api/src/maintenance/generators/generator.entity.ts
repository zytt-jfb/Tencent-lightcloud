import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('maintenance_generators')
@Index('uk_maintenance_generator_code_org', ['generatorCode', 'orgCompany', 'orgRegion'], { unique: true })
@Index('idx_maintenance_generator_org_status', ['orgProvince', 'orgCompany', 'orgRegion', 'status', 'deletedAt'])
export class MaintenanceGeneratorEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ name: 'generator_code', type: 'varchar', length: 100 }) generatorCode: string;
  @Column({ name: 'contact_name', type: 'varchar', length: 100, nullable: true }) contactName: string | null;
  @Column({ name: 'contact_mobile', type: 'varchar', length: 32, nullable: true }) contactMobile: string | null;
  @Column({ name: 'model', type: 'varchar', length: 255, nullable: true }) model: string | null;
  @Column({ name: 'rated_power_kw', type: 'decimal', precision: 12, scale: 3, nullable: true }) ratedPowerKw: number | null;
  @Column({ name: 'standard_fuel_consumption', type: 'decimal', precision: 12, scale: 3, nullable: true }) standardFuelConsumption: number | null;
  @Column({ name: 'generator_type', type: 'varchar', length: 100, nullable: true }) generatorType: string | null;
  @Column({ name: 'fuel_type', type: 'varchar', length: 64, nullable: true }) fuelType: string | null;
  @Column({ name: 'ownership', type: 'varchar', length: 64, nullable: true }) ownership: string | null;
  @Column({ name: 'usage_status', type: 'varchar', length: 64, nullable: true }) usageStatus: string | null;
  @Column({ name: 'external_id', type: 'varchar', length: 100, nullable: true }) externalId: string | null;
  @Column({ name: 'manufacturer', type: 'varchar', length: 255, nullable: true }) manufacturer: string | null;
  @Column({ name: 'production_date', type: 'varchar', length: 64, nullable: true }) productionDate: string | null;
  @Column({ name: 'last_maintenance_upload_at', type: 'varchar', length: 64, nullable: true }) lastMaintenanceUploadAt: string | null;
  @Column({ name: 'org_province', type: 'varchar', length: 160 }) orgProvince: string;
  @Column({ name: 'org_company', type: 'varchar', length: 200 }) orgCompany: string;
  @Column({ name: 'org_region', type: 'varchar', length: 160 }) orgRegion: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status: 'active' | 'inactive';
  @Column({ name: 'deleted_at', type: 'datetime', nullable: true }) deletedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
