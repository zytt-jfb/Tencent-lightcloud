import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('maintenance_personnel')
@Index('uk_maintenance_personnel_code_org', ['personnelCode', 'orgCompany', 'orgRegion'], { unique: true })
@Index('idx_maintenance_personnel_org_status', ['orgProvince', 'orgCompany', 'orgRegion', 'status', 'deletedAt'])
export class MaintenancePersonnelEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'personnel_code', type: 'varchar', length: 100 })
  personnelCode: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  gender: string | null;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  account: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  position: string | null;

  @Column({ name: 'employment_type', type: 'varchar', length: 64, nullable: true })
  employmentType: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  mobile: string | null;

  @Column({ name: 'id_card', type: 'varchar', length: 32, nullable: true })
  idCard: string | null;

  @Column({ name: 'low_voltage_cert', type: 'varchar', length: 160, nullable: true })
  lowVoltageCert: string | null;

  @Column({ name: 'low_voltage_cert_expiry', type: 'varchar', length: 64, nullable: true })
  lowVoltageCertExpiry: string | null;

  @Column({ name: 'high_voltage_cert', type: 'varchar', length: 160, nullable: true })
  highVoltageCert: string | null;

  @Column({ name: 'high_voltage_cert_expiry', type: 'varchar', length: 64, nullable: true })
  highVoltageCertExpiry: string | null;

  @Column({ name: 'work_at_height_cert', type: 'varchar', length: 160, nullable: true })
  workAtHeightCert: string | null;

  @Column({ name: 'work_at_height_cert_expiry', type: 'varchar', length: 64, nullable: true })
  workAtHeightCertExpiry: string | null;

  @Column({ name: 'employer_liability_amount', type: 'varchar', length: 64, nullable: true })
  employerLiabilityAmount: string | null;

  @Column({ name: 'employer_liability_policy_no', type: 'varchar', length: 160, nullable: true })
  employerLiabilityPolicyNo: string | null;

  @Column({ name: 'employer_liability_expiry', type: 'varchar', length: 64, nullable: true })
  employerLiabilityExpiry: string | null;

  @Column({ name: 'team_accident_amount', type: 'varchar', length: 64, nullable: true })
  teamAccidentAmount: string | null;

  @Column({ name: 'team_accident_policy_no', type: 'varchar', length: 160, nullable: true })
  teamAccidentPolicyNo: string | null;

  @Column({ name: 'team_accident_expiry', type: 'varchar', length: 64, nullable: true })
  teamAccidentExpiry: string | null;

  @Column({ name: 'team_accident_amount2', type: 'varchar', length: 64, nullable: true })
  teamAccidentAmount2: string | null;

  @Column({ name: 'team_accident_policy_no2', type: 'varchar', length: 160, nullable: true })
  teamAccidentPolicyNo2: string | null;

  @Column({ name: 'team_accident_expiry2', type: 'varchar', length: 64, nullable: true })
  teamAccidentExpiry2: string | null;

  @Column({ name: 'team_accident_amount3', type: 'varchar', length: 64, nullable: true })
  teamAccidentAmount3: string | null;

  @Column({ name: 'team_accident_policy_no3', type: 'varchar', length: 160, nullable: true })
  teamAccidentPolicyNo3: string | null;

  @Column({ name: 'team_accident_expiry3', type: 'varchar', length: 64, nullable: true })
  teamAccidentExpiry3: string | null;

  @Column({ name: 'personnel_condition', type: 'varchar', length: 255, nullable: true })
  personnelCondition: string | null;

  @Column({ name: 'org_province', type: 'varchar', length: 160 })
  orgProvince: string;

  @Column({ name: 'org_city', type: 'varchar', length: 160, nullable: true })
  orgCity: string | null;

  @Column({ name: 'org_company', type: 'varchar', length: 200 })
  orgCompany: string;

  @Column({ name: 'org_region', type: 'varchar', length: 160 })
  orgRegion: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
