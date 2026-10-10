import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('city_configs')
export class CityConfigEntity {
  @PrimaryColumn({ name: 'city_id', type: 'bigint' })
  cityId: number;

  @Column({ name: 'enable_maintenance', type: 'tinyint', default: 0 })
  enableMaintenance: boolean;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
